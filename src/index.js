import { loadHolidaySet } from "./calendar.js";
import { loadConfig, validateConfig } from "./config.js";
import { startMonitor } from "./monitor.js";

const config = loadConfig();
validateConfig(config);

const holidaySet = loadHolidaySet(config.holidayFile);

console.log(`[monitor] starting for ${config.cubeSymbol}`);
console.log(`[monitor] timezone=${config.timezone}, window=${config.pollStart}-${config.pollEnd}, interval=${config.pollIntervalMs}ms`);
console.log(config.xueqiuCookie ? "[monitor] XUEQIU_COOKIE configured" : "[monitor] XUEQIU_COOKIE empty; trying anonymous access first");

startMonitor({ config, holidaySet });
