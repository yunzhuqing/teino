/**
 * 金额与积分的定点运算。
 *
 * 为什么不用浮点：单价形如 $0.1/M，乘上百万级 token 后浮点误差会直接变成账目差错，
 * 而项目没有任何 decimal 依赖，所以统一把金额放大成整数（BigInt）再运算。
 *
 * 本模块是纯函数、无 IO，刻意不加 "server-only"（它会让 node:test 无法导入）——
 * 客户端组件只从它取类型，运算一律留在服务端。
 *
 * · 金额（原币费用、单价）：1e-8 标度，与 numeric(20,8) 对齐，足以表达 $0.00000001
 * · 积分：1e-6 标度，与 numeric(20,6) 对齐
 * · 倍率一样用整数表达，见 MULTIPLIER_SCALE
 */
export const AMOUNT_DECIMALS = 8;
export const CREDIT_DECIMALS = 6;
/** 单价单位是「每 100 万 token」 */
export const PER_TOKENS = 1_000_000n;

const AMOUNT_FACTOR = 10n ** BigInt(AMOUNT_DECIMALS);
/** 倍率的标度：1e-4，正好对应 numeric(20,4) */
const MULTIPLIER_SCALE = 10_000n;

/** 放大到指定标度的定标整数 */
export type Scaled = bigint;

function parseScaled(value: string | number | bigint | null | undefined, decimals: number): Scaled {
  if (value === null || value === undefined || value === "") return 0n;
  const factor = 10n ** BigInt(decimals);
  const s = String(value).trim();
  if (!/^[+-]?\d*\.?\d*$/.test(s) || s === "" || s === "." || s === "+" || s === "-") throw new Error(`不是合法的数字：${s}`);

  const negative = s.startsWith("-");
  const digits = s.replace(/^[+-]/, "");
  const [intPart = "", fracPart = ""] = digits.split(".");
  // 超出列定义的小数位直接截断：上游给的精度不会超过列定义，截断比进位更不容易放大误差
  const frac = fracPart.padEnd(decimals, "0").slice(0, decimals);
  const scaled = BigInt(intPart || "0") * factor + BigInt(frac || "0");
  return negative ? -scaled : scaled;
}

/** 把数据库读出的 numeric 字符串解析成 1e-8 标度的金额 */
export function parseAmount(value: string | number | bigint | null | undefined): Scaled {
  return parseScaled(value, AMOUNT_DECIMALS);
}

/** 把数据库读出的 numeric 字符串解析成 1e-6 标度的积分 */
export function parseCredit(value: string | number | bigint | null | undefined): Scaled {
  return parseScaled(value, CREDIT_DECIMALS);
}

/** 把倍率（如 1.5 或 "2"）解析成 1e-4 标度 */
export function parseMultiplier(value: string | number | bigint | null | undefined): bigint {
  return parseScaled(value, 4);
}

/** 定标整数 → 数据库字符串（numeric 列接受字符串） */
export function formatScaled(scaled: Scaled, decimals: number): string {
  const factor = 10n ** BigInt(decimals);
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const int = abs / factor;
  const frac = abs % factor;
  const fracStr = frac.toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}${int}.${fracStr}`;
}

export function formatAmount(scaled: Scaled): string {
  return formatScaled(scaled, AMOUNT_DECIMALS);
}

export function formatCredit(scaled: Scaled): string {
  return formatScaled(scaled, CREDIT_DECIMALS);
}

/** 倍率定标整数 → 普通小数（仅用于展示与写日志） */
export function multiplierToNumber(scaled: bigint): number {
  return Number(scaled) / Number(MULTIPLIER_SCALE);
}

/** 四舍五入（half-up，远离零）除法 */
function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
}

/**
 * 按单价计费：token 数 × 每百万单价。
 * 单价与结果同为 1e-8 标度，token 为整数，因此中间不产生任何舍入，只在最后一步做一次 half-up。
 */
export function charge(tokens: number, unitPriceScaled: Scaled): Scaled {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0n;
  return divRound(BigInt(Math.round(tokens)) * unitPriceScaled, PER_TOKENS);
}

/** 各计费维度之和，倍率在合计后一次应用，避免逐项舍入叠加误差 */
export function applyMultiplier(total: Scaled, multiplierScaled: bigint): Scaled {
  return applyFactors(total, [multiplierScaled]);
}

/** 多个乘法因子（倍率、折扣，均为 1e-4 标度）合并后一次应用，整条链路只舍入一次 */
export function applyFactors(total: Scaled, factorsScaled: bigint[]): Scaled {
  let numerator = total;
  let denominator = 1n;
  for (const f of factorsScaled) {
    numerator *= f;
    denominator *= MULTIPLIER_SCALE;
  }
  return divRound(numerator, denominator);
}

/** 金额转积分：按「1 单位主货币 = rate 积分」折算。rate 是汇率，按金额标度解析（与 numeric(20,8) 对齐） */
export function amountToCredits(amountScaled: Scaled, creditRateScaled: Scaled): Scaled {
  // amount(1e-8) × rate(1e-8) / 1e8 → A*R 的 1e-8 标度，再降到积分的 1e-6
  const inAmountScale = divRound(amountScaled * creditRateScaled, AMOUNT_FACTOR);
  return divRound(inAmountScale, 10n ** BigInt(AMOUNT_DECIMALS - CREDIT_DECIMALS));
}

/** 金额标度（1e-8）→ 积分标度（1e-6），数值不变。用于 credit 模式：价格数字本身就是积分 */
export function amountScaleToCredit(amountScaled: Scaled): Scaled {
  return divRound(amountScaled, 10n ** BigInt(AMOUNT_DECIMALS - CREDIT_DECIMALS));
}

/** 按汇率折算到主货币：1 单位本币种 = rate 主货币 */
export function convertCurrency(amountScaled: Scaled, rateScaled: Scaled): Scaled {
  return divRound(amountScaled * rateScaled, AMOUNT_FACTOR);
}
