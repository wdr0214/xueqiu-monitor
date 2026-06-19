#!/usr/bin/env python3
"""Monitor a public Xueqiu cube and push rebalance notices through WeChat."""

from __future__ import annotations

import json
import os
import random
import re
import sys
import time
import http.cookiejar
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, time as dt_time, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    from curl_cffi import requests as curl_requests
except ImportError:  # GitHub Actions installs this dependency.
    curl_requests = None


XUEQIU_HISTORY_API = "https://xueqiu.com/cubes/rebalancing/history.json"
XUEQIU_SHOW_API = "https://xueqiu.com/cubes/show.json"
XUEQIU_ANALYZE_PAGE = "https://xueqiu.com/service/p/cube-analyze"
WECHAT_TOKEN_API = "https://api.weixin.qq.com/cgi-bin/token"
WECHAT_TEMPLATE_API = "https://api.weixin.qq.com/cgi-bin/message/template/send"
COOKIE_JAR = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(COOKIE_JAR))

HISTORY_FILE = Path(os.getenv("HISTORY_FILE", "history.json"))
TIMEZONE_NAME = os.getenv("TZ", "Asia/Shanghai")
POLL_START = os.getenv("POLL_START", "09:00")
POLL_END = os.getenv("POLL_END", "15:30")
SEND_INITIAL_REBALANCE = os.getenv("SEND_INITIAL_REBALANCE", "false").strip().lower() in {"1", "true", "yes", "y"}
XUEQIU_RETRY_SECONDS = int(os.getenv("XUEQIU_RETRY_SECONDS", "120"))
MAX_NOTIFIED_REBALANCE_IDS = int(os.getenv("MAX_NOTIFIED_REBALANCE_IDS", "30"))


class MonitorError(Exception):
    pass


def load_timezone(name: str):
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        if name in {"Asia/Shanghai", "Asia/Chongqing", "PRC", "UTC"}:
            offset = 8 if name != "UTC" else 0
            return timezone(timedelta(hours=offset), name)
        raise


TIMEZONE = load_timezone(TIMEZONE_NAME)


@dataclass(frozen=True)
class Config:
    xueqiu_url: str
    wechat_app_id: str
    wechat_app_secret: str
    wechat_to_openid: str
    wechat_template_id: str
    xueqiu_cookie: str = ""

    @property
    def cube_symbol(self) -> str:
        match = re.search(r"/P/([A-Za-z0-9_]+)", self.xueqiu_url)
        if match:
            return match.group(1)
        parsed = urllib.parse.urlparse(self.xueqiu_url)
        params = urllib.parse.parse_qs(parsed.query)
        symbol = params.get("symbol", [""])[0] or params.get("cube_symbol", [""])[0]
        if symbol:
            return symbol
        raise MonitorError("无法从 XUEQIU_URL 解析组合代码，例如 https://xueqiu.com/P/ZH188094")


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise MonitorError(f"缺少环境变量：{name}")
    return value


def load_config() -> Config:
    return Config(
        xueqiu_url=required_env("XUEQIU_URL"),
        wechat_app_id=required_env("WECHAT_APP_ID"),
        wechat_app_secret=required_env("WECHAT_APP_SECRET"),
        wechat_to_openid=required_env("WECHAT_TO_OPENID"),
        wechat_template_id=required_env("WECHAT_TEMPLATE_ID"),
        xueqiu_cookie=os.getenv("XUEQIU_COOKIE", "").strip(),
    )


def now_text() -> str:
    return datetime.now(TIMEZONE).strftime("%Y-%m-%d %H:%M:%S")


def parse_clock(value: str) -> dt_time:
    parts = [int(part) for part in value.split(":")]
    if len(parts) == 2:
        return dt_time(parts[0], parts[1])
    if len(parts) == 3:
        return dt_time(parts[0], parts[1], parts[2])
    raise MonitorError(f"时间格式错误：{value}")


def in_trading_window() -> bool:
    now = datetime.now(TIMEZONE)
    return parse_clock(POLL_START) <= now.time() <= parse_clock(POLL_END)


def request_text(url: str, *, cookie: str = "") -> str:
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,text/plain,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "Referer": "https://xueqiu.com/",
    }
    if cookie:
        headers["Cookie"] = cookie

    if curl_requests is not None:
        try:
            response = curl_requests.get(url, headers=headers, timeout=20, impersonate="chrome")
            if response.status_code >= 400:
                raise MonitorError(f"HTTP {response.status_code}: {response.text[:300]}")
            return response.text
        except MonitorError:
            raise
        except Exception as exc:
            raise MonitorError(f"Text request failed: {exc}") from exc

    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with OPENER.open(req, timeout=20) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise MonitorError(f"HTTP {exc.code}: {detail[:300]}") from exc
    except urllib.error.URLError as exc:
        raise MonitorError(f"Text request failed: {exc.reason}") from exc


def request_json(url: str, *, method: str = "GET", body: dict[str, Any] | None = None, cookie: str = "") -> Any:
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "Referer": "https://xueqiu.com/",
    }
    if cookie:
        headers["Cookie"] = cookie

    if curl_requests is not None:
        try:
            response = curl_requests.request(
                method,
                url,
                headers=headers,
                json=body,
                timeout=20,
                impersonate="chrome",
            )
            raw = response.text
            if response.status_code >= 400:
                raise MonitorError(f"网络请求失败 HTTP {response.status_code}: {raw[:300]}")
        except MonitorError:
            raise
        except Exception as exc:
            raise MonitorError(f"网络请求异常：{exc}") from exc
    else:
        payload = None
        if body is not None:
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")

        req = urllib.request.Request(url, data=payload, headers=headers, method=method)
        try:
            with OPENER.open(req, timeout=20) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise MonitorError(f"网络请求失败 HTTP {exc.code}: {detail[:300]}") from exc
        except urllib.error.URLError as exc:
            raise MonitorError(f"网络请求异常：{exc.reason}") from exc

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise MonitorError(f"返回内容不是 JSON：{raw[:300]}") from exc

    if isinstance(data, dict) and data.get("error_code"):
        raise MonitorError(f"接口返回错误：{data}")
    return data


def random_delay() -> None:
    delay = random.uniform(1, 3)
    print(f"[{now_text()}] 随机延时 {delay:.2f}s")
    time.sleep(delay)


def fetch_rebalance_records(config: Config) -> list[dict[str, Any]]:
    params = urllib.parse.urlencode({"cube_symbol": config.cube_symbol, "count": 20, "page": 1})
    data = request_json(f"{XUEQIU_HISTORY_API}?{params}", cookie=config.xueqiu_cookie)
    if not isinstance(data, dict):
        raise MonitorError("Xueqiu rebalance response is not an object")
    records = data.get("list") or data.get("data", {}).get("list") or data.get("rebalancing_histories") or []
    if not isinstance(records, list):
        raise MonitorError("Xueqiu rebalance list is missing or invalid")
    return records


def prime_xueqiu_session(config: Config) -> None:
    if config.xueqiu_cookie:
        return
    req = urllib.request.Request(
        config.xueqiu_url,
        headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "User-Agent": "Mozilla/5.0 XueqiuCubeMonitor/1.0",
        },
        method="GET",
    )
    try:
        with OPENER.open(req, timeout=20) as resp:
            resp.read(1024)
    except urllib.error.URLError as exc:
        print(f"[{now_text()}] 雪球会话初始化失败，将继续尝试接口：{exc}", file=sys.stderr)


def fetch_holdings(config: Config) -> dict[str, float]:
    params = urllib.parse.urlencode({"symbol": config.cube_symbol})
    data = request_json(f"{XUEQIU_SHOW_API}?{params}", cookie=config.xueqiu_cookie)
    if not isinstance(data, dict):
        raise MonitorError("Xueqiu holdings response is not an object")
    items = find_holding_items(data)
    if items is None:
        html = request_text(f"{XUEQIU_ANALYZE_PAGE}?{params}", cookie=config.xueqiu_cookie)
        items = find_holding_items(extract_cube_info_from_html(html))
    if not isinstance(items, list):
        raise MonitorError("Xueqiu holdings list is missing or invalid")

    holdings: dict[str, float] = {}

    for item in items:
        name = pick(item, "stock_name", "stockName", "name", "stock_symbol", "symbol")
        weight = pick(item, "weight", "target_weight", "targetWeight", "proactive_weight")
        if name is None or weight in (None, ""):
            continue
        try:
            holdings[str(name)] = round(float(weight), 4)
        except (TypeError, ValueError):
            continue
    return holdings


def find_holding_items(data: dict[str, Any]) -> list[dict[str, Any]] | None:
    view_rebalancing = data.get("view_rebalancing")
    if isinstance(view_rebalancing, dict):
        items = view_rebalancing.get("holdings") or view_rebalancing.get("rebalancing_histories")
        if isinstance(items, list):
            return items

    for key in ("last_rebalancing", "last_success_rebalancing"):
        rebalancing = data.get(key)
        if isinstance(rebalancing, dict) and isinstance(rebalancing.get("holdings"), list):
            return rebalancing["holdings"]

    cube = data.get("cube") if isinstance(data.get("cube"), dict) else None
    if isinstance(cube, dict) and isinstance(cube.get("holdings"), list):
        return cube["holdings"]

    holdings = data.get("holdings")
    return holdings if isinstance(holdings, list) else None


def extract_cube_info_from_html(html: str) -> dict[str, Any]:
    marker = "SNB.cubeInfo = "
    start = html.find(marker)
    if start < 0:
        raise MonitorError("Xueqiu analyze page missing SNB.cubeInfo")
    start += len(marker)
    end = html.find(";</script>", start)
    if end < 0:
        raise MonitorError("Xueqiu analyze page cubeInfo terminator missing")
    try:
        data = json.loads(html[start:end])
    except json.JSONDecodeError as exc:
        raise MonitorError("Xueqiu analyze page cubeInfo is not valid JSON") from exc
    if not isinstance(data, dict):
        raise MonitorError("Xueqiu analyze page cubeInfo is not an object")
    return data


def fetch_xueqiu_snapshot(config: Config) -> tuple[list[dict[str, Any]], dict[str, float]]:
    last_error: MonitorError | None = None
    for attempt in range(2):
        try:
            if attempt:
                prime_xueqiu_session(config)
            return fetch_rebalance_records(config), fetch_holdings(config)
        except MonitorError as exc:
            last_error = exc
            if attempt == 0:
                print(f"[{now_text()}] Xueqiu fetch failed: {exc}. Retry in {XUEQIU_RETRY_SECONDS}s.", file=sys.stderr)
                time.sleep(XUEQIU_RETRY_SECONDS)
                continue
            break
    raise MonitorError(f"Xueqiu fetch failed after retry; no notification sent: {last_error}")


def pick(mapping: dict[str, Any], *names: str) -> Any:
    for name in names:
        value = mapping.get(name)
        if value not in (None, ""):
            return value
    return None


def load_history() -> dict[str, Any]:
    if not HISTORY_FILE.exists():
        return {"notified_rebalance_ids": [], "holdings": {}, "updated_at": None}
    with HISTORY_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_history(history: dict[str, Any]) -> None:
    history["notified_rebalance_ids"] = list(dict.fromkeys(history.get("notified_rebalance_ids", [])))[-MAX_NOTIFIED_REBALANCE_IDS:]
    history["updated_at"] = now_text()
    tmp = HISTORY_FILE.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    tmp.replace(HISTORY_FILE)


def record_id(record: dict[str, Any], index: int) -> str:
    for key in ("id", "rebalancing_id", "updated_at", "created_at", "created"):
        value = record.get(key)
        if value not in (None, ""):
            return str(value)
    return f"record-{index}-{json.dumps(record, ensure_ascii=False, sort_keys=True)[:80]}"


def normalize_change(item: dict[str, Any]) -> dict[str, str]:
    name = pick(item, "stock_name", "stockName", "name", "stock_symbol", "symbol") or "未知股票"
    symbol = pick(item, "stock_symbol", "stockSymbol", "symbol")
    prev_weight = pick(item, "prev_weight", "prevWeight", "prev_target_weight", "prevTargetWeight")
    target_weight = pick(item, "target_weight", "targetWeight", "weight", "after_weight", "afterWeight")
    price = pick(item, "price", "rebalanced_price", "rebalancedPrice", "trade_price", "tradePrice") or "未披露"
    action = pick(item, "action", "action_name", "actionName") or describe_weight_change(prev_weight, target_weight)
    stock = f"{name}({symbol})" if symbol and str(symbol) not in str(name) else str(name)
    return {"action": str(action), "stock": stock, "price": str(price)}


def describe_weight_change(prev: Any, target: Any) -> str:
    try:
        previous = float(prev or 0)
        current = float(target or 0)
    except (TypeError, ValueError):
        return "调仓"
    if previous == 0 and current > 0:
        return f"买入 {previous:g}% -> {current:g}%"
    if current == 0 and previous > 0:
        return f"卖出 {previous:g}% -> {current:g}%"
    if current > previous:
        return f"增持 {previous:g}% -> {current:g}%"
    if current < previous:
        return f"减持 {previous:g}% -> {current:g}%"
    return f"持仓 {previous:g}% -> {current:g}%"


def extract_changes_from_record(record: dict[str, Any]) -> list[dict[str, str]]:
    items = record.get("rebalancing_histories") or record.get("histories") or record.get("stocks") or [record]
    return [normalize_change(item) for item in items if isinstance(item, dict)]


def compare_holdings(old: dict[str, float], new: dict[str, float]) -> list[dict[str, str]]:
    changes: list[dict[str, str]] = []
    for stock in sorted(set(old) | set(new)):
        before = old.get(stock, 0)
        after = new.get(stock, 0)
        if round(before, 4) == round(after, 4):
            continue
        if before == 0:
            action = f"买入 0% -> {after:g}%"
        elif after == 0:
            action = f"卖出 {before:g}% -> 0%"
        elif after > before:
            action = f"增持 {before:g}% -> {after:g}%"
        else:
            action = f"减持 {before:g}% -> {after:g}%"
        changes.append({"action": action, "stock": stock, "price": "未披露"})
    return changes


def fetch_wechat_access_token(config: Config) -> str:
    params = urllib.parse.urlencode({
        "grant_type": "client_credential",
        "appid": config.wechat_app_id,
        "secret": config.wechat_app_secret,
    })
    data = request_json(f"{WECHAT_TOKEN_API}?{params}")
    token = data.get("access_token") if isinstance(data, dict) else None
    if not token:
        raise MonitorError(f"微信 access_token 获取失败：{data}")
    return str(token)


def push_wechat(config: Config, changes: list[dict[str, str]]) -> None:
    token = fetch_wechat_access_token(config)
    for change in changes:
        body = {
            "touser": config.wechat_to_openid,
            "template_id": config.wechat_template_id,
            "data": {
                "stockName": {"value": change["stock"]},
                "rebalanceChange": {"value": change["action"]},
                "rebalancePrice": {"value": change["price"]},
                "remark": {"value": f"雪球组合调仓监控自动推送｜{now_text()}"},
            },
        }
        result = request_json(f"{WECHAT_TEMPLATE_API}?access_token={token}", method="POST", body=body)
        if isinstance(result, dict) and result.get("errcode") not in (None, 0):
            raise MonitorError(f"微信模板消息发送失败：{result}")
        print(f"[{now_text()}] 微信测试号推送结果：{result}")


def main() -> int:
    if not in_trading_window():
        print(f"[{now_text()}] 非交易监控时段，跳过")
        return 0

    config = load_config()
    history = load_history()
    random_delay()
    prime_xueqiu_session(config)

    records, current_holdings = fetch_xueqiu_snapshot(config)
    notified_ids = set(history.get("notified_rebalance_ids", []))

    direct_changes: list[dict[str, str]] = []
    pending_records: list[tuple[str, list[dict[str, str]]]] = []
    new_record_ids: list[str] = []
    for index, record in enumerate(records):
        rid = record_id(record, index)
        if rid in notified_ids:
            continue
        changes = extract_changes_from_record(record)
        if changes:
            direct_changes.extend(changes)
            pending_records.append((rid, changes))
            new_record_ids.append(rid)

    if not history.get("holdings") and not notified_ids:
        if not current_holdings and not pending_records:
            print(f"[{now_text()}] Empty holdings on initial run; skip baseline and notification.")
            return 0
        if SEND_INITIAL_REBALANCE and pending_records:
            latest_record_id, latest_changes = pending_records[0]
            push_wechat(config, latest_changes)
            history["holdings"] = current_holdings
            history["notified_rebalance_ids"] = [latest_record_id]
            save_history(history)
            print(f"[{now_text()}] 首次运行，已推送最新调仓并建立基线")
            return 0
        history["holdings"] = current_holdings
        history["notified_rebalance_ids"] = list(dict.fromkeys(new_record_ids or [record_id(r, i) for i, r in enumerate(records[:1])]))[-MAX_NOTIFIED_REBALANCE_IDS:]
        save_history(history)
        print(f"[{now_text()}] 首次运行，已建立基线，不推送")
        return 0

    if not current_holdings and not direct_changes:
        print(f"[{now_text()}] Empty holdings without direct rebalance changes; skip notification and history update.")
        return 0

    changes = direct_changes or compare_holdings(history.get("holdings", {}), current_holdings)
    if changes:
        push_wechat(config, changes)
        if current_holdings:
            history["holdings"] = current_holdings
        history["notified_rebalance_ids"] = list(dict.fromkeys((history.get("notified_rebalance_ids", []) + new_record_ids)))[-MAX_NOTIFIED_REBALANCE_IDS:]
        save_history(history)
    else:
        print(f"[{now_text()}] 未发现调仓")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except MonitorError as exc:
        print(f"[{now_text()}] 监控失败：{exc}", file=sys.stderr)
        raise SystemExit(1)
    except Exception as exc:
        print(f"[{now_text()}] 未预期异常：{exc}", file=sys.stderr)
        raise SystemExit(1)
