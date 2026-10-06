/**
 * 网关默认时区。
 *
 * 原先 "Asia/Shanghai" 以字面量散落在 ui.tsx、api-keys.ts、keys/page.tsx 三处，
 * 时段计费也需要按同一时区判定「当日分钟数」，所以收敛到一处。
 * 时段表本身允许每行声明自己的时区（billing_periods.timezone），这里只是默认值。
 */
export const DEFAULT_TIMEZONE = "Asia/Shanghai";

/** 本地时区相对 UTC 的分钟偏移（东八区为 +480） */
export const DEFAULT_UTC_OFFSET_MINUTES = 8 * 60;

/** 把某时刻换算成指定时区的「当日分钟数」（0-1439） */
export function minuteOfDay(date: Date, timezone: string = DEFAULT_TIMEZONE): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  // hour12:false 在部分实现下把午夜给成 24
  return ((hour % 24) * 60 + minute) % 1440;
}

/** 分钟数 → HH:mm，用于后台时段表的展示与编辑 */
export function minutesToHHMM(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** HH:mm → 分钟数 */
export function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}
