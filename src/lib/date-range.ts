import { DEFAULT_UTC_OFFSET_MINUTES } from "./timezone";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const OFFSET_MS = DEFAULT_UTC_OFFSET_MINUTES * 60 * 1000;

export interface DateRange {
  /** YYYY-MM-DD（北京时间），用于回填表单 */
  from: string;
  to: string;
  /** [start, end) 绝对时刻，end 是 to 次日零点 */
  start: Date;
  end: Date;
}

/** 某时刻在北京时间的日期 YYYY-MM-DD */
export function localDate(at: Date): string {
  return new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

function startOfLocalDay(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - OFFSET_MS);
}

function isValidDate(v: string | undefined): v is string {
  return !!v && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

/**
 * 解析查询参数里的日期区间（按北京时间整天计，两端都包含）。
 * 缺省或非法时取最近 defaultDays 天（含今天）；起止颠倒时自动交换。
 */
export function parseDateRange(params: { from?: string; to?: string }, defaultDays: number, now = new Date()): DateRange {
  let to = isValidDate(params.to) ? params.to : localDate(now);
  let from = isValidDate(params.from) ? params.from : localDate(new Date(startOfLocalDay(to).getTime() - (defaultDays - 1) * DAY_MS));
  if (from > to) [from, to] = [to, from];
  return { from, to, start: startOfLocalDay(from), end: new Date(startOfLocalDay(to).getTime() + DAY_MS) };
}
