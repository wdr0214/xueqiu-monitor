import test from "node:test";
import assert from "node:assert/strict";
import { buildWxPusherPayload, sendWxPusherMessage } from "../src/wxpusher.js";

const config = {
  appToken: "AT_xxx",
  uid: "UID_xxx",
  dryRun: true
};

test("builds WxPusher payload", () => {
  const payload = buildWxPusherPayload(config, {
    stockName: "贵州茅台(SH600519)",
    change: "买入 0% -> 10%",
    price: "1500"
  }, new Date("2026-06-11T02:00:00.000Z"));

  assert.equal(payload.appToken, "AT_xxx");
  assert.deepEqual(payload.uids, ["UID_xxx"]);
  assert.equal(payload.summary, "雪球组合调仓提醒");
  assert.match(payload.content, /贵州茅台/);
  assert.match(payload.content, /1500/);
});

test("dry-run sender returns payload without network", async () => {
  const result = await sendWxPusherMessage(config, {
    stockName: "招商银行(SH600036)",
    change: "卖出 8% -> 0%",
    price: "未披露"
  });

  assert.equal(result.dryRun, true);
  assert.match(result.payload.content, /招商银行/);
});
