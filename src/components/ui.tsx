import type { ReactNode } from "react";

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-zinc-400">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-zinc-400">{icon}</div>
      <div className="text-sm font-medium text-zinc-200">{title}</div>
      {hint ? <div className="max-w-sm text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}

export function StatusDot({ on }: { on: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${on ? "text-emerald-300" : "text-zinc-500"}`}>
      <span className={`size-1.5 rounded-full ${on ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" : "bg-zinc-600"}`} />
      {on ? "启用" : "停用"}
    </span>
  );
}

export function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] text-zinc-300 ${className}`}>
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
    timeZone: "Asia/Shanghai",
  }).format(d);
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { notation: n >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
}
