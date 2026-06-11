const SEND_URL = "https://www.pushplus.plus/send";

export function buildPushPlusContent(change, now = new Date()) {
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

export function buildPushPlusPayload(config, change, now = new Date()) {
  return {
    token: config.token,
    title: "雪球组合调仓提醒",
    content: buildPushPlusContent(change, now),
    template: "txt"
  };
}

export async function sendPushPlusMessage(config, change, fetchImpl = fetch) {
  const payload = buildPushPlusPayload(config, change);
  if (config.dryRun) {
    console.log("[pushplus:dry-run]", JSON.stringify(payload));
    return { dryRun: true, payload };
  }

  const response = await fetchImpl(SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || result.code !== 200) {
    throw new Error(`PushPlus message failed: ${JSON.stringify(result)}`);
  }
  return result;
}
