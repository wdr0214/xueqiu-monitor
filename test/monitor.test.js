import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkOnce } from "../src/monitor.js";

function makeConfig(stateFile) {
  return {
    cubeSymbol: "ZH188094",
    timezone: "Asia/Shanghai",
    pollStart: "09:00:00",
    pollEnd: "15:30:00",
    xueqiuCookie: "",
    stateFile,
    wechat: {
      dryRun: true,
      toOpenId: "openid",
      templateId: "tpl",
      fields: {
        stockName: "stockName",
        change: "rebalanceChange",
        price: "rebalancePrice",
        remark: "remark"
      }
    }
  };
}

test("first run creates a baseline without sending old historical records", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xueqiu-monitor-"));
  const stateFile = path.join(dir, "state.json");
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      list: [
        {
          id: "old",
          rebalancing_histories: [
            { stock_name: "贵州茅台", stock_symbol: "SH600519", prev_weight: 0, target_weight: 10, price: 1500 }
          ]
        }
      ]
    })
  });

  const result = await checkOnce({
    config: makeConfig(stateFile),
    holidaySet: new Set(),
    fetchImpl,
    now: new Date("2026-06-11T02:00:00.000Z")
  });

  assert.equal(result.baselineCreated, true);
  assert.equal(result.notifiedRecords, 0);
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.deepEqual(state.notifiedRecordIds, ["old"]);
});
