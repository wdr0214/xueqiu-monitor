import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..");

function env(name, fallback = "") {
  return process.env[name] ?? fallback;
}

function parseInteger(name, fallback) {
  const raw = env(name, String(fallback));
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function resolveProjectPath(value, fallback) {
  const target = value || fallback;
  if (path.isAbsolute(target)) return target;

  const candidates = [
    path.resolve(projectRoot, target),
    path.resolve(process.cwd(), target),
    path.resolve(projectRoot, "..", target)
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

export function loadConfig() {
  return {
    cubeSymbol: env("CUBE_SYMBOL", "ZH188094"),
    timezone: env("TZ", "Asia/Shanghai"),
    pollStart: env("POLL_START", "09:00:00"),
    pollEnd: env("POLL_END", "15:30:00"),
    pollIntervalMs: parseInteger("POLL_INTERVAL_MS", 1000),
    xueqiuCookie: env("XUEQIU_COOKIE", ""),
    stateFile: resolveProjectPath(env("STATE_FILE"), "data/state.json"),
    holidayFile: resolveProjectPath(env("HOLIDAY_FILE"), "config/market-holidays.cn-a.json"),
    wechat: {
      appId: env("WECHAT_APP_ID", ""),
      appSecret: env("WECHAT_APP_SECRET", ""),
      toOpenId: env("WECHAT_TO_OPENID", ""),
      templateId: env("WECHAT_TEMPLATE_ID", ""),
      dryRun: env("WECHAT_DRY_RUN", "false").toLowerCase() === "true",
      fields: {
        stockName: env("WECHAT_FIELD_STOCK_NAME", "stockName"),
        change: env("WECHAT_FIELD_CHANGE", "rebalanceChange"),
        price: env("WECHAT_FIELD_PRICE", "rebalancePrice"),
        remark: env("WECHAT_FIELD_REMARK", "remark")
      }
    },
    wxpusher: {
      appToken: env("WXPUSHER_APP_TOKEN", ""),
      uid: env("WXPUSHER_UID", ""),
      dryRun: env("WXPUSHER_DRY_RUN", env("WECHAT_DRY_RUN", "false")).toLowerCase() === "true"
    }
  };
}

export function validateConfig(config) {
  if (!config.cubeSymbol) throw new Error("CUBE_SYMBOL is required");
  if (!fs.existsSync(config.holidayFile)) {
    throw new Error(`HOLIDAY_FILE does not exist: ${config.holidayFile}`);
  }

  const hasWxPusher = Boolean(config.wxpusher?.appToken && config.wxpusher?.uid);
  if (hasWxPusher || config.wxpusher?.dryRun) return;

  const missingWechat = [
    ["WECHAT_APP_ID", config.wechat.appId],
    ["WECHAT_APP_SECRET", config.wechat.appSecret],
    ["WECHAT_TO_OPENID", config.wechat.toOpenId],
    ["WECHAT_TEMPLATE_ID", config.wechat.templateId]
  ].filter(([, value]) => !value);

  if (missingWechat.length > 0 && !config.wechat.dryRun) {
    const names = missingWechat.map(([name]) => name).join(", ");
    throw new Error(`Missing WeChat configuration: ${names}. Set WECHAT_DRY_RUN=true only for local smoke tests.`);
  }
}
