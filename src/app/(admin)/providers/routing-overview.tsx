import { GitBranch } from "lucide-react";
import { groupByPriority } from "@/lib/gateway/routing";
import type { getProvidersWithModels } from "@/lib/queries";

type Providers = Awaited<ReturnType<typeof getProvidersWithModels>>;

const BAR_COLORS = ["#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#14b8a6"];

/** 按对外模型名汇总所有供应商，展示优先级分层与层内流量占比（不考虑标签约束） */
export function RoutingOverview({ providers }: { providers: Providers }) {
  const byName = new Map<string, { provider: string; priority: number; weight: number }[]>();
  for (const p of providers) {
    if (!p.enabled) continue;
    for (const m of p.models) {
      if (!m.enabled) continue;
      const entry = { provider: p.name, priority: m.priority, weight: m.weight };
      const list = byName.get(m.name);
      if (list) list.push(entry);
      else byName.set(m.name, [entry]);
    }
  }
  if (byName.size === 0) return null;
  const names = [...byName.keys()].sort();

  return (
    <section className="glass mb-5 p-5">
      <div className="mb-4 flex items-center gap-2">
        <GitBranch className="size-4 text-violet-500" />
        <h2 className="text-sm font-semibold">路由总览</h2>
        <span className="text-xs text-zinc-500">按模型名汇总启用的上游 · 高优先级层优先 · 层内按权重分流（未考虑标签过滤）</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {names.map((name) => {
          const tiers = groupByPriority(byName.get(name) ?? []);
          return (
            <div key={name} className="rounded-xl border border-zinc-900/8 bg-white/50 p-3.5">
              <div className="mb-2.5 font-mono text-[13px] font-medium">{name}</div>
              <div className="space-y-2.5">
                {tiers.map((tier, ti) => {
                  const total = tier.items.reduce((s, i) => s + Math.max(0, i.weight), 0);
                  return (
                    <div key={tier.priority}>
                      <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
                        <span>
                          {ti === 0 ? "主层" : `降级 ${ti}`} · 优先级 {tier.priority}
                        </span>
                      </div>
                      <div className="flex h-2 overflow-hidden rounded-full bg-zinc-900/10">
                        {tier.items.map((i, idx) =>
                          i.weight > 0 ? (
                            <div key={idx} style={{ width: `${(i.weight / total) * 100}%`, backgroundColor: BAR_COLORS[idx % BAR_COLORS.length] }} />
                          ) : null,
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-600">
                        {tier.items.map((i, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1">
                            <span className="size-1.5 rounded-full" style={{ backgroundColor: BAR_COLORS[idx % BAR_COLORS.length] }} />
                            {i.provider}
                            <span className="tabular-nums text-zinc-500">{total > 0 && i.weight > 0 ? `${Math.round((i.weight / total) * 1000) / 10}%` : "兜底"}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
