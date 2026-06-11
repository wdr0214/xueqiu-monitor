import { getStore } from "@netlify/blobs";
import { loadHolidaySet, shouldPollNow } from "../../src/calendar.js";
import { loadConfig, validateConfig } from "../../src/config.js";
import { filterUnnotified, markNotified } from "../../src/state.js";
import { sendPushPlusMessage } from "../../src/pushplus.js";
import { fetchRebalanceHistory, parseRebalanceRecords, XueqiuAuthError } from "../../src/xueqiu.js";
import { sendTemplateMessage } from "../../src/wechat.js";
import { sendWxPusherMessage } from "../../src/wxpusher.js";

const EMPTY_STATE = {
  notifiedRecordIds: [],
  lastSeenRecordId: null,
  lastCheckedAt: null
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadBlobState(store) {
  const raw = await store.get("state.json");
  if (!raw) return { ...EMPTY_STATE };
  return { ...EMPTY_STATE, ...JSON.parse(raw) };
}

async function saveBlobState(store, state) {
  await store.setJSON("state.json", state);
}

async function checkWithBlobState({ config, holidaySet, store, fetchImpl = fetch, now = new Date() }) {
  const gate = shouldPollNow({
    now,
    timezone: config.timezone,
    holidaySet,
    pollStart: config.pollStart,
    pollEnd: config.pollEnd
  });

  if (!gate.shouldPoll) {
    return { status: "skipped", reason: "outside-trading-window", gate };
  }

  const payload = await fetchRebalanceHistory({
    cubeSymbol: config.cubeSymbol,
    cookie: config.xueqiuCookie,
    fetchImpl
  });
  const records = parseRebalanceRecords(payload);
  const state = await loadBlobState(store);

  if (!state.lastSeenRecordId && (state.notifiedRecordIds ?? []).length === 0) {
    await saveBlobState(store, markNotified(state, records));
    return { status: "checked", totalRecords: records.length, notifiedRecords: 0, baselineCreated: true, gate };
  }

  const unnotified = filterUnnotified(records, state);
  for (const record of unnotified.reverse()) {
    for (const change of record.changes) {
      if (config.wechat?.appId && config.wechat?.appSecret && config.wechat?.toOpenId && config.wechat?.templateId) {
        await sendTemplateMessage(config.wechat, change, fetchImpl);
      } else if (config.pushplus?.token || config.pushplus?.dryRun) {
        await sendPushPlusMessage(config.pushplus, change, fetchImpl);
      } else {
        await sendWxPusherMessage(config.wxpusher, change, fetchImpl);
      }
    }
  }

  await saveBlobState(store, markNotified(state, unnotified.length > 0 ? unnotified : records.slice(0, 1)));
  return { status: "checked", totalRecords: records.length, notifiedRecords: unnotified.length, gate };
}

export default async function handler() {
  const config = loadConfig();
  validateConfig(config);

  const holidaySet = loadHolidaySet(config.holidayFile);
  const store = getStore("xueqiu-rebalance-monitor");
  const maxRunSeconds = Number.parseInt(process.env.NETLIFY_RUN_SECONDS ?? "25", 10);
  const deadline = Date.now() + Math.min(Math.max(maxRunSeconds, 1), 28) * 1000;

  const results = [];
  while (Date.now() < deadline) {
    try {
      const result = await checkWithBlobState({ config, holidaySet, store, now: new Date() });
      results.push(result);
      console.log("[netlify:monitor]", JSON.stringify(result));
      if (result.status === "skipped") break;
    } catch (error) {
      if (error instanceof XueqiuAuthError) {
        console.error("[netlify:monitor] Xueqiu requires login Cookie. Set XUEQIU_COOKIE.", error.details ?? "");
        results.push({ status: "error", reason: "xueqiu-auth" });
        break;
      }
      console.error("[netlify:monitor] check failed", error);
      results.push({ status: "error", reason: error.message });
      break;
    }

    if (Date.now() + config.pollIntervalMs >= deadline) break;
    await sleep(config.pollIntervalMs);
  }

  return Response.json({
    ok: true,
    mode: "netlify-scheduled-function",
    checks: results.length,
    last: results.at(-1) ?? null
  });
}
