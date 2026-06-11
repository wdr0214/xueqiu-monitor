import fs from "node:fs";
import path from "node:path";

const EMPTY_STATE = {
  notifiedRecordIds: [],
  lastSeenRecordId: null,
  lastCheckedAt: null
};

export function loadState(filePath) {
  if (!fs.existsSync(filePath)) return { ...EMPTY_STATE };
  const raw = fs.readFileSync(filePath, "utf8");
  return { ...EMPTY_STATE, ...JSON.parse(raw) };
}

export function saveState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function filterUnnotified(records, state) {
  const notified = new Set(state.notifiedRecordIds ?? []);
  return records.filter((record) => record.id && !notified.has(record.id));
}

export function markNotified(state, records, checkedAt = new Date().toISOString()) {
  const notified = new Set(state.notifiedRecordIds ?? []);
  for (const record of records) {
    if (record.id) notified.add(record.id);
  }

  const newest = records[0]?.id ?? state.lastSeenRecordId ?? null;
  return {
    ...state,
    notifiedRecordIds: Array.from(notified).slice(-500),
    lastSeenRecordId: newest,
    lastCheckedAt: checkedAt
  };
}
