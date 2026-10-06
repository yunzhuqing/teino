import type { ReactNode } from "react";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-zinc-600">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-zinc-900/10 bg-white/70 text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">{icon}</div>
      <div className="text-sm font-medium text-zinc-800">{title}</div>
      {hint ? <div className="max-w-sm text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}

export function StatusDot({ on }: { on: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${on ? "text-emerald-600" : "text-zinc-500"}`}>
      <span className={`size-1.5 rounded-full ${on ? "bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/70" : "bg-zinc-400"}`} />
      {on ? "启用" : "停用"}
    </span>
  );
}

export function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border border-zinc-900/10 bg-white/70 px-1.5 py-0.5 text-[11px] text-zinc-600 ${className}`}>
      {children}
    </span>
  );
}

export function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: DEFAULT_TIMEZONE,
  }).format(d);
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { notation: n >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", CNY: "¥" };

/**
 * 金额展示。入参是数据库读出的 numeric 字符串（或数字），按币种保留合适的小数位。
 * 不能用 formatNumber：它用 compact 记法，且对 $0.0042 这类小额会直接变成 0。
 */
export function formatMoney(amount: string | number | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "—";
  const symbol = currency ? (CURRENCY_SYMBOLS[currency] ?? "") : "";
  const suffix = currency && !symbol ? ` ${currency}` : "";
  // 小额费用要保留足够位数才看得见，大额则不需要
  const abs = Math.abs(n);
  const digits = abs === 0 ? 2 : abs < 0.01 ? 6 : abs < 1 ? 4 : 2;
  return `${symbol}${n.toFixed(digits)}${suffix}`;
}

/** 积分展示：保留 2 位小数即可，避免表格里出现一长串零 */
export function formatCreditAmount(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
}
