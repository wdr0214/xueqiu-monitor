export class XueqiuAuthError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "XueqiuAuthError";
    this.details = details;
  }
}

const LOGIN_ERROR_CODES = new Set(["400016", "401", "403"]);

export async function fetchRebalanceHistory({ cubeSymbol, cookie = "", count = 20, page = 1, fetchImpl = fetch }) {
  const url = new URL("https://xueqiu.com/cubes/rebalancing/history.json");
  url.searchParams.set("cube_symbol", cubeSymbol);
  url.searchParams.set("count", String(count));
  url.searchParams.set("page", String(page));

  const response = await fetchImpl(url, {
    headers: {
      "Accept": "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0 XueqiuCubeMonitor/1.0",
      "Referer": `https://xueqiu.com/P/${cubeSymbol}`,
      ...(cookie ? { "Cookie": cookie } : {})
    }
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }

  const errorCode = String(payload?.error_code ?? response.status);
  if (!response.ok || payload?.error_code) {
    if (LOGIN_ERROR_CODES.has(errorCode) || String(payload?.error_description ?? "").includes("登录")) {
      throw new XueqiuAuthError("Xueqiu requires a valid login Cookie", payload);
    }
    throw new Error(`Xueqiu request failed: ${response.status} ${text}`);
  }

  return payload;
}

export function extractRawRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.list)) return payload.list;
  if (Array.isArray(payload?.data?.list)) return payload.data.list;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.rebalancing_histories)) return payload.rebalancing_histories;
  return [];
}

function pick(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function describeWeightChange(prevWeight, targetWeight) {
  const prev = toNumber(prevWeight);
  const target = toNumber(targetWeight);
  if (prev === null && target === null) return "调仓";
  if ((prev ?? 0) === 0 && (target ?? 0) > 0) return `买入 0% -> ${target}%`;
  if ((target ?? 0) === 0 && (prev ?? 0) > 0) return `清仓 ${prev}% -> 0%`;
  if (prev !== null && target !== null && target > prev) return `增持 ${prev}% -> ${target}%`;
  if (prev !== null && target !== null && target < prev) return `减持 ${prev}% -> ${target}%`;
  return `${prev ?? "?"}% -> ${target ?? "?"}%`;
}

export function normalizeRecord(rawRecord, index = 0) {
  const histories = rawRecord.rebalancing_histories ?? rawRecord.histories ?? rawRecord.stocks ?? [rawRecord];
  const updatedAt = pick(rawRecord.updated_at, rawRecord.updatedAt, rawRecord.created_at, rawRecord.createdAt, rawRecord.created);
  const id = String(pick(rawRecord.id, rawRecord.rebalancing_id, rawRecord.rebalancingId, updatedAt, `record-${index}`));

  const changes = histories.map((item) => {
    const stockName = pick(item.stock_name, item.stockName, item.name, item.stock?.name, item.stock_symbol, item.symbol, "未知股票");
    const stockSymbol = pick(item.stock_symbol, item.stockSymbol, item.symbol, item.stock?.symbol, "");
    const prevWeight = pick(item.prev_weight, item.prevWeight, item.prev_target_weight, item.prevTargetWeight);
    const targetWeight = pick(item.target_weight, item.targetWeight, item.weight, item.after_weight, item.afterWeight);
    const price = pick(item.price, item.rebalanced_price, item.rebalancedPrice, item.trade_price, item.tradePrice);

    return {
      stockName: stockSymbol ? `${stockName}(${stockSymbol})` : String(stockName),
      change: pick(item.action, item.action_name, item.actionName, describeWeightChange(prevWeight, targetWeight)),
      price: price === undefined || price === null || price === "" ? "未披露" : String(price)
    };
  });

  return {
    id,
    updatedAt: updatedAt ? String(updatedAt) : null,
    changes,
    raw: rawRecord
  };
}

export function parseRebalanceRecords(payload) {
  return extractRawRecords(payload).map(normalizeRecord);
}
