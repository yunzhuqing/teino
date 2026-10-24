import Link from "next/link";
import { ArrowUpRight, Boxes, Layers, Server } from "lucide-react";
import { EmptyState, PageHeader, Pill } from "@/components/ui";
import { getMyModels } from "@/lib/console";
import { API_TYPE_LABELS } from "@/lib/gateway/upstream";
import { discountLabel, PriceRange } from "./pricing";

export default async function MyModelsPage() {
  const { models } = await getMyModels();
  const supplierCount = new Set(models.flatMap((m) => m.suppliers.map((s) => s.name))).size;
  return (
    <>
      <PageHeader title="模型广场" description="发现可用模型，对比供应商价格与折扣，选择适合你的调用方案。" />
      <div className="mb-6 flex flex-wrap items-center gap-3 text-xs text-zinc-600">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 ring-1 ring-zinc-900/8"><Boxes className="size-3.5" />{models.length} 个可用模型</span>
        <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 ring-1 ring-zinc-900/8"><Server className="size-3.5" />{supplierCount} 个供应商</span>
        <span>价格 / 百万 token · 已包含折扣</span>
      </div>
      {models.length === 0 ? (
        <section className="glass"><EmptyState icon={<Boxes className="size-5" />} title="暂无可用模型" hint="请联系管理员开通模型访问权限。" /></section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {models.map((m) => (
            <Link key={m.name} href={{ pathname: "/console/models/detail", query: { model: m.name } }} className="glass group flex min-w-0 flex-col p-5 transition duration-200 hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-500 motion-reduce:transform-none motion-reduce:transition-none">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600"><Boxes className="size-5" /></div>
                <span className="flex items-center gap-1 text-xs text-zinc-500 group-hover:text-violet-600">查看详情<ArrowUpRight className="size-4" /></span>
              </div>
              <h2 className="break-all font-mono text-base font-semibold text-zinc-900">{m.name}</h2>
              <div className="mt-3 flex flex-wrap gap-1.5">{m.apiTypes.map((t) => <Pill key={t}>{API_TYPE_LABELS[t]}</Pill>)}{m.tiered ? <Pill><Layers className="mr-1 size-3" />阶梯定价</Pill> : null}</div>
              <div className="my-5 grid grid-cols-2 gap-4 rounded-xl bg-white/60 p-3 ring-1 ring-zinc-900/5">
                <div><p className="mb-1 text-xs text-zinc-500">输入 / 百万 token</p><div className="text-sm font-semibold tabular-nums"><PriceRange prices={m.prices} dimension="input" /></div></div>
                <div><p className="mb-1 text-xs text-zinc-500">输出 / 百万 token</p><div className="text-sm font-semibold tabular-nums"><PriceRange prices={m.prices} dimension="output" /></div></div>
              </div>
              <div className="mt-auto border-t border-zinc-900/8 pt-3">
                <p className="mb-2 text-xs text-zinc-500">{m.suppliers.length} 个供应商 · 价格与折扣</p>
                <div className="flex flex-wrap gap-2">{m.suppliers.map((s) => <span key={s.id} className="inline-flex items-center gap-1.5 rounded-md bg-white/80 px-2 py-1 text-xs text-zinc-600">{s.name}<span className={s.discount < 1 ? "font-medium text-emerald-600" : "text-zinc-500"}>{discountLabel(s.discount)}</span></span>)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
      <p className="mt-5 text-xs leading-5 text-zinc-500">卡片显示最高路由优先级供应商的基础档价格。点击模型查看全部供应商、缓存价格和阶梯定价；实际费用以请求明细为准。</p>
    </>
  );
}
