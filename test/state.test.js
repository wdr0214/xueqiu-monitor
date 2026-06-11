import test from "node:test";
import assert from "node:assert/strict";
import { filterUnnotified, markNotified } from "../src/state.js";

test("filters and marks notified rebalance records", () => {
  const state = { notifiedRecordIds: ["old"], lastSeenRecordId: "old", lastCheckedAt: null };
  const records = [{ id: "new" }, { id: "old" }];
  assert.deepEqual(filterUnnotified(records, state), [{ id: "new" }]);

  const next = markNotified(state, [{ id: "new" }], "2026-06-11T01:00:00.000Z");
  assert.deepEqual(next.notifiedRecordIds, ["old", "new"]);
  assert.equal(next.lastSeenRecordId, "new");
  assert.equal(next.lastCheckedAt, "2026-06-11T01:00:00.000Z");
});
