import { Activity } from "lucide-react";
import { EmptyState, formatCreditAmount, formatDate, formatMoney, formatNumber, PageHeader, Pill } from "@/components/ui";
import { API_TYPE_LABELS } from "@/lib/gateway/upstream";
import { getRecentLogs } from "@/lib/stats";
import { BillingDetail } from "./billing-detail";

function statusClass(status: number) {
  if (status >= 200 && status < 400) return "bg-emerald-500/15 text-emerald-300";
  if (status >= 400 && status < 500) return "bg-amber-500/15 text-amber-300";
  return "bg-rose-500/15 text-rose-300";
}

export default async function LogsPage() {
  const logs = await getRecentLogs(200);
  return (
    <>
      <PageHeader title="请求日志" description="最近 200 条网关请求（含故障转移尝试次数、token 用量与计费结果）" />
      <section className="glass overflow-hidden">
        {logs.length === 0 ? (
          <EmptyState icon={<Activity className="size-5" />} title="暂无请求记录" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>状态</th>
                  <th>模型</th>
                  <th>接口</th>
                  <th>供应商</th>
                  <th>调用方</th>
                  <th className="text-right">尝试</th>
                  <th className="text-right">延迟</th>
                  <th className="text-right">Tokens 入/出</th>
                  <th className="text-right">缓存 命中/创建</th>
                  <th className="text-right">费用</th>
                  <th className="text-right">积分</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} title={l.error ?? undefined}>
                    <td className="text-xs whitespace-nowrap text-zinc-400">{formatDate(l.createdAt)}</td>
                    <td>
                      <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${statusClass(l.status)}`}>{l.status}</span>
                    </td>
                    <td className="font-mono text-xs">
                      {l.model}
                      {l.stream ? <Pill className="ml-1.5">stream</Pill> : null}
                    </td>
                    <td className="text-xs whitespace-nowrap text-zinc-400">
                      {API_TYPE_LABELS[l.apiType]}
                      {l.upstreamApiType ? <span className="text-sky-300"> → {API_TYPE_LABELS[l.upstreamApiType]}</span> : null}
                    </td>
                    <td className="text-zinc-300">{l.providerName ?? "—"}</td>
                    <td className="text-xs text-zinc-400">
                      {l.userName ?? "—"}
                      {l.keyName ? <span className="text-zinc-600"> / {l.keyName}</span> : null}
                    </td>
                    <td className={`text-right tabular-nums ${l.attempts > 1 ? "text-amber-300" : "text-zinc-400"}`}>{l.attempts}</td>
                    <td className="text-right tabular-nums text-zinc-300">{formatNumber(l.latencyMs)} ms</td>
                    <td className="text-right text-xs tabular-nums text-zinc-400">
                      {formatNumber(l.inputTokens)} / {formatNumber(l.outputTokens)}
                    </td>
                    <td className="text-right text-xs tabular-nums text-zinc-400">
                      {l.cacheReadTokens || l.cacheWriteTokens ? (
                        <>
                          {formatNumber(l.cacheReadTokens)} / {formatNumber(l.cacheWriteTokens)}
                        </>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="text-right text-xs tabular-nums text-zinc-300">
                      {Number(l.costOriginal) > 0 ? (
                        <div className="flex flex-col items-end">
                          <span>{formatMoney(l.costOriginal, l.currency)}</span>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[10px]">
                            {/* 非 1 倍或命中非兜底时段时标出来，便于一眼看出计价规则 */}
                            {l.period && l.period !== "all" ? <span className="text-sky-300">{l.period}</span> : null}
                            {l.multiplier && Number(l.multiplier) !== 1 ? <span className="text-amber-300">×{l.multiplier}</span> : null}
                            <BillingDetail
                              model={l.model}
                              providerName={l.providerName}
                              currency={l.currency}
                              costOriginal={l.costOriginal}
                              creditsCharged={l.creditsCharged}
                              period={l.period}
                              priorityTier={l.priorityTier}
                              multiplier={l.multiplier}
                              snapshot={l.priceSnapshot}
                              balanceAfter={l.balanceAfter}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="text-right text-xs tabular-nums text-violet-200">
                      {Number(l.creditsCharged) !== 0 ? formatCreditAmount(l.creditsCharged) : <span className="text-zinc-600">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
