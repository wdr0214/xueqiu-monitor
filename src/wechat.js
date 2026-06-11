const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token";
const SEND_TEMPLATE_URL = "https://api.weixin.qq.com/cgi-bin/message/template/send";

let cachedToken = null;

export function buildTemplatePayload(config, change) {
  const fields = config.fields;
  return {
    touser: config.toOpenId,
    template_id: config.templateId,
    data: {
      [fields.stockName]: { value: change.stockName },
      [fields.change]: { value: change.change },
      [fields.price]: { value: change.price },
      [fields.remark]: { value: "雪球组合调仓监控自动推送" }
    }
  };
}

export async function getAccessToken(config, fetchImpl = fetch, now = Date.now()) {
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const url = new URL(TOKEN_URL);
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", config.appId);
  url.searchParams.set("secret", config.appSecret);

  const response = await fetchImpl(url);
  const payload = await response.json();
  if (!response.ok || payload.errcode) {
    throw new Error(`WeChat access_token request failed: ${JSON.stringify(payload)}`);
  }

  cachedToken = {
    value: payload.access_token,
    expiresAt: now + Number(payload.expires_in ?? 7200) * 1000
  };
  return cachedToken.value;
}

export async function sendTemplateMessage(config, change, fetchImpl = fetch) {
  const payload = buildTemplatePayload(config, change);
  if (config.dryRun) {
    console.log("[wechat:dry-run]", JSON.stringify(payload));
    return { dryRun: true, payload };
  }

  const token = await getAccessToken(config, fetchImpl);
  const url = new URL(SEND_TEMPLATE_URL);
  url.searchParams.set("access_token", token);

  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || result.errcode) {
    throw new Error(`WeChat template message failed: ${JSON.stringify(result)}`);
  }
  return result;
}
