import test from "node:test";
import assert from "node:assert/strict";
import { parseRebalanceRecords, XueqiuAuthError, fetchRebalanceHistory } from "../src/xueqiu.js";

test("parses rebalance records and formats stock changes", () => {
  const records = parseRebalanceRecords({
    list: [
      {
        id: 123,
        rebalancing_histories: [
          { stock_name: "贵州茅台", stock_symbol: "SH600519", prev_weight: 0, target_weight: 10, price: 1500 },
          { stock_name: "招商银行", stock_symbol: "SH600036", prev_weight: 8, target_weight: 0 }
        ]
      }
    ]
  });

  assert.equal(records[0].id, "123");
  assert.deepEqual(records[0].changes, [
    { stockName: "贵州茅台(SH600519)", change: "买入 0% -> 10%", price: "1500" },
    { stockName: "招商银行(SH600036)", change: "清仓 8% -> 0%", price: "未披露" }
  ]);
});

test("throws a clear auth error when Xueqiu asks for login", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ error_code: "400016", error_description: "重新登录帐号后再试" })
  });

  await assert.rejects(
    () => fetchRebalanceHistory({ cubeSymbol: "ZH188094", fetchImpl }),
    XueqiuAuthError
  );
});
