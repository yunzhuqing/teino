import Link from "next/link";
import { Activity, BarChart3, Coins, KeyRound, Wallet, Zap } from "lucide-react";
import { EmptyState, formatCreditAmount, formatMoney, formatNumber, PageHeader } from "@/components/ui";
import { getMyUsage, type UsageBucket } from "@/lib/console";
import { parseDateRange } from "@/lib/date-range";
import { buildQuery, FilterBar, firstParam } from "./filters";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function UsagePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const range = parseDateRange({ from: firstParam(sp.from), to: firstParam(sp.to) }, 30);
  const usage = await getMyUsage(range);
  const { total, baseCurrency } = usage;
  const successRate = total.requests ? Math.round((total.success / total.requests) * 1000) / 10 : null;
  const rangeQuery = { from: range.from, to: range.to };

  const metrics = [
    { label: `费用${baseCurrency ? `（${baseCurrency}）` : ""}`, value: formatMoney(total.cost, baseCurrency), icon: Coins, tone: "text-amber-500" },
    { label: "扣除积分", value: formatCreditAmount(total.credits), icon: Coins, tone: "text-violet-500" },
    { label: "请求数", value: formatNumber(total.requests), icon: Activity, tone: "text-sky-500" },
    { label: "成功率", value: successRate == null ? "—" : `${successRate}%`, icon: Zap, tone: "text-emerald-500" },
    { label: "Tokens（入 / 出）", value: `${formatNumber(total.inputTokens)} / ${formatNumber(total.outputTokens)}`, icon: BarChart3, tone: "text-pink-500" },
    { label: "缓存（命中 / 创建）", value: `${formatNumber(total.cacheReadTokens)} / ${formatNumber(total.cacheWriteTokens)}`, icon: BarChart3, tone: "text-sky-500" },
    { label: "Key 余额合计（积分）", value: formatCreditAmount(usage.balance), icon: Wallet, tone: "text-emerald-500", href: "/console/keys" },
  ];

  return (
    <>
      <PageHeader title="用量" description="按 API Key 与模型统计的费用和 token 用量（日期按北京时间，费用已折算为主货币）" />
      <FilterBar action="/console" range={range} resetHref="/console" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon, tone, href }) => {
          const body = (
            <>
              <div className="flex items-center justify-between text-xs text-zinc-500">
                {label}
                <Icon className={`size-4 ${tone}`} />
              </div>
              <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
            </>
          );
          return href ? (
            <Link key={label} href={href} className="glass p-5 transition hover:bg-white/75">
              {body}
            </Link>
          ) : (
            <div key={label} className="glass p-5">
              {body}
            </div>
          );
        })}
      </div>

      <UsageTable
        title="按 API Key"
        empty="还没有 API Key"
        icon={<KeyRound className="size-5" />}
        baseCurrency={baseCurrency}
        totalCost={total.cost}
        rows={usage.keys.map((k) => ({
          key: k.id ?? "deleted",
          label: (
            <>
              <div className="font-medium">{k.name}</div>
              {k.keyPrefix ? <div className="font-mono text-xs text-zinc-500">{k.keyPrefix}</div> : null}
            </>
          ),
          extra: k.creditBalance !== null ? formatCreditAmount(k.creditBalance) : "—",
          usage: k.usage,
          href: k.id ? `/console/logs${buildQuery({ ...rangeQuery, key: k.id })}` : null,
        }))}
        extraLabel="当前余额"
      />

      <UsageTable
        title="按模型"
        empty="所选时间内没有请求"
        icon={<BarChart3 className="size-5" />}
        baseCurrency={baseCurrency}
        totalCost={total.cost}
        rows={usage.models.map((m) => ({
          key: m.model,
          label: <span className="font-mono text-xs">{m.model}</span>,
          usage: m.usage,
          href: `/console/logs${buildQuery({ ...rangeQuery, model: m.model })}`,
        }))}
      />
    </>
  );
}

interface UsageRow {
  key: string;
  label: React.ReactNode;
  extra?: string;
  usage: UsageBucket;
  href: string | null;
}

function UsageTable({
  title,
  rows,
  empty,
  icon,
  baseCurrency,
  totalCost,
  extraLabel,
}: {
  title: string;
  rows: UsageRow[];
  empty: string;
  icon: React.ReactNode;
  baseCurrency: string | null;
  totalCost: string;
  extraLabel?: string;
}) {
  const total = Number(totalCost);
  return (
    <section className="glass mt-5 overflow-hidden">
      <h2 className="border-b border-zinc-900/10 px-5 py-3.5 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <EmptyState icon={icon} title={empty} />
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{title.replace("按 ", "")}</th>
                <th className="text-right">请求</th>
                <th className="text-right">Tokens 入 / 出</th>
                <th className="text-right">缓存 命中 / 创建</th>
                <th className="text-right">费用{baseCurrency ? `（${baseCurrency}）` : ""}</th>
                <th className="w-40">占比</th>
                <th className="text-right">积分</th>
                {extraLabel ? <th className="text-right">{extraLabel}</th> : null}
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const share = total > 0 ? Number(r.usage.cost) / total : 0;
                return (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td className="text-right tabular-nums">
                      {formatNumber(r.usage.requests)}
                      {r.usage.requests > r.usage.success ? <div className="text-[11px] text-rose-600">失败 {formatNumber(r.usage.requests - r.usage.success)}</div> : null}
                    </td>
                    <td className="text-right text-xs tabular-nums text-zinc-600">
                      {formatNumber(r.usage.inputTokens)} / {formatNumber(r.usage.outputTokens)}
                    </td>
                    <td className="text-right text-xs tabular-nums text-zinc-600">
                      {formatNumber(r.usage.cacheReadTokens)} / {formatNumber(r.usage.cacheWriteTokens)}
                    </td>
                    <td className="text-right font-mono text-sm tabular-nums">{formatMoney(r.usage.cost, baseCurrency)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-900/8">
                          <div className="h-full rounded-full bg-violet-500" style={{ width: `${share * 100}%` }} />
                        </div>
                        <span className="w-10 text-right text-[11px] tabular-nums text-zinc-500">{Math.round(share * 100)}%</span>
                      </div>
                    </td>
                    <td className="text-right text-xs tabular-nums text-violet-700">{formatCreditAmount(r.usage.credits)}</td>
                    {extraLabel ? <td className="text-right font-mono text-xs tabular-nums">{r.extra}</td> : null}
                    <td className="text-right">
                      {r.href && r.usage.requests > 0 ? (
                        <Link href={r.href} className="text-xs text-violet-600 hover:text-violet-800">
                          明细
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
