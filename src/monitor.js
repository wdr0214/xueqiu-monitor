import { shouldPollNow } from "./calendar.js";
import { filterUnnotified, loadState, markNotified, saveState } from "./state.js";
import { fetchRebalanceHistory, parseRebalanceRecords, XueqiuAuthError } from "./xueqiu.js";
import { sendTemplateMessage } from "./wechat.js";

export async function checkOnce({ config, holidaySet, fetchImpl = fetch, now = new Date() }) {
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
  const state = loadState(config.stateFile);

  if (!state.lastSeenRecordId && (state.notifiedRecordIds ?? []).length === 0) {
    const nextState = markNotified(state, records);
    saveState(config.stateFile, nextState);
    return { status: "checked", totalRecords: records.length, notifiedRecords: 0, baselineCreated: true, gate };
  }

  const unnotified = filterUnnotified(records, state);

  for (const record of unnotified.reverse()) {
    for (const change of record.changes) {
      await sendTemplateMessage(config.wechat, change, fetchImpl);
    }
  }

  const nextState = markNotified(state, unnotified.length > 0 ? unnotified : records.slice(0, 1));
  saveState(config.stateFile, nextState);
  return { status: "checked", totalRecords: records.length, notifiedRecords: unnotified.length, gate };
}

export function startMonitor({ config, holidaySet, fetchImpl = fetch }) {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const result = await checkOnce({ config, holidaySet, fetchImpl });
      if (result.status === "checked") {
        console.log(`[monitor] checked ${config.cubeSymbol}; notified records=${result.notifiedRecords}`);
      }
    } catch (error) {
      if (error instanceof XueqiuAuthError) {
        console.error("[monitor] Xueqiu requires login Cookie. Set XUEQIU_COOKIE in .env.", error.details ?? "");
      } else {
        console.error("[monitor] check failed", error);
      }
    } finally {
      running = false;
    }
  }

  void tick();
  return setInterval(tick, config.pollIntervalMs);
}
