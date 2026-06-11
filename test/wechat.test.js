import test from "node:test";
import assert from "node:assert/strict";
import { buildTemplatePayload, sendTemplateMessage } from "../src/wechat.js";

const config = {
  appId: "app",
  appSecret: "secret",
  toOpenId: "openid",
  templateId: "tpl",
  dryRun: true,
  fields: {
    stockName: "stockName",
    change: "rebalanceChange",
    price: "rebalancePrice",
    remark: "remark"
  }
};

test("builds WeChat template message payload", () => {
  const payload = buildTemplatePayload(config, {
    stockName: "贵州茅台(SH600519)",
    change: "买入 0% -> 10%",
    price: "1500"
  });

  assert.equal(payload.touser, "openid");
  assert.equal(payload.template_id, "tpl");
  assert.equal(payload.data.stockName.value, "贵州茅台(SH600519)");
  assert.equal(payload.data.rebalanceChange.value, "买入 0% -> 10%");
  assert.equal(payload.data.rebalancePrice.value, "1500");
});

test("dry-run sender returns payload without network", async () => {
  const result = await sendTemplateMessage(config, {
    stockName: "招商银行(SH600036)",
    change: "清仓 8% -> 0%",
    price: "未披露"
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.payload.data.rebalancePrice.value, "未披露");
});
