import fs from "node:fs";

export function loadHolidaySet(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return new Set(parsed.closedDates ?? []);
}

export function getZonedParts(date = new Date(), timeZone = "Asia/Shanghai") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    time: `${parts.hour}:${parts.minute}:${parts.second}`
  };
}

export function isTradingDate(dateString, weekday, holidaySet) {
  if (weekday === "Sat" || weekday === "Sun") return false;
  return !holidaySet.has(dateString);
}

export function isTimeInWindow(timeString, start = "09:00:00", end = "15:30:00") {
  return timeString >= start && timeString <= end;
}

export function shouldPollNow({ now = new Date(), timezone, holidaySet, pollStart, pollEnd }) {
  const parts = getZonedParts(now, timezone);
  return {
    shouldPoll: isTradingDate(parts.date, parts.weekday, holidaySet) && isTimeInWindow(parts.time, pollStart, pollEnd),
    ...parts
  };
}
