const SEND_URL = "https://wxpusher.zjiecode.com/api/send/message";

export function buildWxPusherContent(change, now = new Date()) {
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(now);

  return [
    "雪球组合调仓提醒",
    `时间：${time}`,
    `操作：${change.change}`,
    `股票：${change.stockName}`,
    `成交价格：${change.price}`
  ].join("\n");
}

export function buildWxPusherPayload(config, change, now = new Date()) {
  return {
    appToken: config.appToken,
    content: buildWxPusherContent(change, now),
    summary: "雪球组合调仓提醒",
    contentType: 1,
    uids: [config.uid]
  };
}

export async function sendWxPusherMessage(config, change, fetchImpl = fetch) {
  const payload = buildWxPusherPayload(config, change);
  if (config.dryRun) {
    console.log("[wxpusher:dry-run]", JSON.stringify(payload));
    return { dryRun: true, payload };
  }

  const response = await fetchImpl(SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  const success = result.code === 1000 || result.success === true;
  if (!response.ok || !success) {
    throw new Error(`WxPusher message failed: ${JSON.stringify(result)}`);
  }
  return result;
}
