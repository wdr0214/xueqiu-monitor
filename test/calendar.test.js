import test from "node:test";
import assert from "node:assert/strict";
import { isTimeInWindow, isTradingDate, shouldPollNow } from "../src/calendar.js";

test("skips weekends and configured market holidays", () => {
  const holidays = new Set(["2026-10-01"]);
  assert.equal(isTradingDate("2026-06-11", "Thu", holidays), true);
  assert.equal(isTradingDate("2026-06-13", "Sat", holidays), false);
  assert.equal(isTradingDate("2026-06-14", "Sun", holidays), false);
  assert.equal(isTradingDate("2026-10-01", "Thu", holidays), false);
});

test("polling window includes both endpoints", () => {
  assert.equal(isTimeInWindow("08:59:59", "09:00:00", "15:30:00"), false);
  assert.equal(isTimeInWindow("09:00:00", "09:00:00", "15:30:00"), true);
  assert.equal(isTimeInWindow("15:30:00", "09:00:00", "15:30:00"), true);
  assert.equal(isTimeInWindow("15:30:01", "09:00:00", "15:30:00"), false);
});

test("shouldPollNow combines trading date and time window", () => {
  const result = shouldPollNow({
    now: new Date("2026-06-11T02:00:00.000Z"),
    timezone: "Asia/Shanghai",
    holidaySet: new Set(),
    pollStart: "09:00:00",
    pollEnd: "15:30:00"
  });
  assert.equal(result.date, "2026-06-11");
  assert.equal(result.time, "10:00:00");
  assert.equal(result.shouldPoll, true);
});
