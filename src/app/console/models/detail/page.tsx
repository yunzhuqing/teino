import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Server } from "lucide-react";
import { PageHeader, Pill } from "@/components/ui";
import { getMyModels } from "@/lib/console";
import { API_TYPE_LABELS } from "@/lib/gateway/upstream";
import { discountLabel, formatModelPrice } from "../pricing";

const dimensions = [{ key: "input", label: "输入" }, { key: "output", label: "输出" }, { key: "cacheRead", label: "缓存命中" }, { key: "cacheWrite", label: "缓存创建" }] as const;

export default async function ModelDetailPage({ searchParams }: { searchParams: Promise<{ model?: string | string[] }> }) {
  const [{ model: name }, { models }] = await Promise.all([searchParams, getMyModels()]);
  const model = models.find((m) => m.name === name);
  if (!model) notFound();
  return (
    <>
      <Link href="/console/models" className="mb-5 inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-violet-600"><ArrowLeft className="size-4" />返回模型广场</Link>
      <div className="break-all"><PageHeader title={model.name} description="对比各供应商折扣及完整价格档。所有价格均为每 100 万 token。" /></div>
      <div className="mb-6 flex flex-wrap gap-2">{model.apiTypes.map((t) => <Pill key={t}>{API_TYPE_LABELS[t]}</Pill>)}<Pill>{model.suppliers.length} 个供应商</Pill></div>
      <div className="space-y-5">
        {model.suppliers.map((s) => (
          <section key={s.id} className="glass overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-900/8 p-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600"><Server className="size-5" /></div>
                <div><h2 className="break-all font-semibold">{s.name}</h2><p className="mt-1 text-xs text-zinc-500">{s.billingMode === "credit" ? "积分计费" : `${s.currency ?? "未配置币种"} 计费`} · {s.primary ? "优先路由" : "备用路由"}</p></div>
              </div>
              <div className="text-right"><span className={`text-xl font-semibold ${s.discount < 1 ? "text-emerald-600" : "text-zinc-800"}`}>{discountLabel(s.discount)}</span><p className="mt-1 text-xs text-zinc-500">{s.discount < 1 ? `较原价节省 ${Number(((1 - s.discount) * 100).toFixed(2))}%` : "折后价 = 原价 × 折扣率"}</p></div>
            </header>
            {s.tiers.length === 0 ? <p className="p-5 text-sm text-zinc-500">暂未配置价格档，请联系管理员确认费用。</p> : (
              <div className="overflow-x-auto">
                <table className="table">
                  <caption className="sr-only">{s.name} 的价格档，单价为每百万 token</caption>
                  <thead><tr><th>上下文 / 时段</th>{dimensions.map((d) => <th key={d.key} className="text-right">{d.label}<span className="mt-1 block text-[10px] font-normal text-zinc-400">原价 → 折后价</span></th>)}</tr></thead>
                  <tbody>{s.tiers.map((tier) => (
                    <tr key={tier.id}>
                      <td><p className="whitespace-nowrap text-sm tabular-nums">{tier.contextMin.toLocaleString("en-US")} ≤ tokens {tier.contextMax === null ? "· 无上限" : `< ${tier.contextMax.toLocaleString("en-US")}`}</p><p className="mt-1 text-xs text-zinc-500">{tier.period === "all" ? "默认时段" : tier.period}</p></td>
                      {dimensions.map((d) => <td key={d.key} className="text-right tabular-nums"><p className={`text-xs text-zinc-400 ${s.discount !== 1 ? "line-through" : ""}`}>{formatModelPrice(tier[d.key], s)}</p><p className="mt-1 whitespace-nowrap text-sm font-medium text-zinc-800">{formatModelPrice(tier[d.key] * s.discount, s)}</p></td>)}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>
      <p className="mt-5 text-xs leading-5 text-zinc-500">供应商折扣按当前模型单独配置。网关自动选择供应商；调用所用 Key 的权限、路由及请求优先级倍率会影响实际费用，以请求明细为准。</p>
    </>
  );
}
