import Link from "next/link";
import { Activity, ChevronLeft, ChevronRight } from "lucide-react";
import { BillingDetail } from "@/components/billing-detail";
import { EmptyState, formatCreditAmount, formatDate, formatMoney, formatNumber, PageHeader, Pill } from "@/components/ui";
import { getMyKeys, getMyLogModels, getMyLogs, LOGS_PAGE_SIZE } from "@/lib/console";
import { parseDateRange } from "@/lib/date-range";
import { API_TYPE_LABELS } from "@/lib/gateway/upstream";
import { buildQuery, FilterBar, FilterSelect, firstParam } from "../filters";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function statusClass(status: number) {
  if (status >= 200 && status < 400) return "bg-emerald-500/15 text-emerald-700";
  if (status >= 400 && status < 500) return "bg-amber-500/15 text-amber-700";
  return "bg-rose-500/15 text-rose-700";
}

export default async function MyLogsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const range = parseDateRange({ from: firstParam(sp.from), to: firstParam(sp.to) }, 7);
  const keyParam = firstParam(sp.key);
  // 非法 id 直接忽略，否则 Postgres 会因 uuid 类型转换报错
  const apiKeyId = keyParam && UUID_RE.test(keyParam) ? keyParam : undefined;
  const model = firstParam(sp.model)?.trim() || undefined;
  const page = Math.max(1, Math.floor(Number(firstParam(sp.page)) || 1));

  const [keys, modelNames, { rows, hasMore }] = await Promise.all([getMyKeys(), getMyLogModels(range), getMyLogs({ apiKeyId, model, range, page })]);
  // 筛选值不在选项里（如区间改了）时也保留，避免下拉框默默回到「全部」
  const modelOptions = model && !modelNames.includes(model) ? [model, ...modelNames] : modelNames;
  const filters = { from: range.from, to: range.to, key: apiKeyId, model };

  return (
    <>
      <PageHeader title="请求明细" description="每次调用的状态、token 用量与计费结果（日期按北京时间）" />
      <FilterBar action="/console/logs" range={range} resetHref="/console/logs">
        <FilterSelect id="f-key" name="key" label="API Key" value={apiKeyId} allLabel="全部 Key" options={keys.map((k) => ({ value: k.id, label: k.name }))} />
        <FilterSelect id="f-model" name="model" label="模型" value={model} allLabel="全部模型" options={modelOptions.map((m) => ({ value: m, label: m }))} />
      </FilterBar>

      <section className="glass overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<Activity className="size-5" />} title="没有符合条件的请求" hint={page > 1 ? "已经是最后一页了。" : "试试放宽时间范围或筛选条件。"} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>状态</th>
                  <th>模型</th>
                  <th>接口</th>
                  <th>API Key</th>
                  <th className="text-right">延迟</th>
                  <th className="text-right">Tokens 入/出</th>
                  <th className="text-right">缓存 命中/创建</th>
                  <th className="text-right">费用</th>
                  <th className="text-right">积分</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td className="text-xs whitespace-nowrap text-zinc-500">{formatDate(l.createdAt)}</td>
                    <td>
                      <span title={l.error ?? undefined} className={`rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${statusClass(l.status)}`}>
                        {l.status}
                      </span>
                      {l.error ? <div className="mt-1 max-w-56 truncate text-[11px] text-rose-600" title={l.error}>{l.error}</div> : null}
                    </td>
                    <td className="font-mono text-xs">
                      {l.model}
                      {l.stream ? <Pill className="ml-1.5">stream</Pill> : null}
                    </td>
                    <td className="text-xs whitespace-nowrap text-zinc-500">{API_TYPE_LABELS[l.apiType]}</td>
                    <td className="text-xs text-zinc-600">{l.keyName ?? <span className="text-zinc-400">已删除</span>}</td>
                    <td className="text-right tabular-nums text-zinc-700">{formatNumber(l.latencyMs)} ms</td>
                    <td className="text-right text-xs tabular-nums text-zinc-500">
                      {formatNumber(l.inputTokens)} / {formatNumber(l.outputTokens)}
                    </td>
                    <td className="text-right text-xs tabular-nums text-zinc-500">
                      {l.cacheReadTokens || l.cacheWriteTokens ? (
                        <>
                          {formatNumber(l.cacheReadTokens)} / {formatNumber(l.cacheWriteTokens)}
                        </>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="text-right text-xs tabular-nums text-zinc-700">
                      {Number(l.costOriginal) > 0 ? (
                        <div className="flex flex-col items-end">
                          <span>{formatMoney(l.costOriginal, l.currency)}</span>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[10px]">
                            {l.period && l.period !== "all" ? <span className="text-sky-600">{l.period}</span> : null}
                            {l.multiplier && Number(l.multiplier) !== 1 ? <span className="text-amber-600">×{l.multiplier}</span> : null}
                            <BillingDetail
                              model={l.model}
                              providerName={null}
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
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="text-right text-xs tabular-nums text-violet-700">
                      {Number(l.creditsCharged) !== 0 ? formatCreditAmount(l.creditsCharged) : <span className="text-zinc-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {page > 1 || hasMore ? (
          <div className="flex items-center justify-between border-t border-zinc-900/10 px-4 py-3 text-xs text-zinc-500">
            <span>
              第 {page} 页 · 每页 {LOGS_PAGE_SIZE} 条
            </span>
            <div className="flex gap-2">
              {page > 1 ? (
                <Link href={`/console/logs${buildQuery({ ...filters, page: page - 1 })}`} className="btn-ghost px-3 py-1.5 text-xs">
                  <ChevronLeft className="size-3.5" />
                  上一页
                </Link>
              ) : null}
              {hasMore ? (
                <Link href={`/console/logs${buildQuery({ ...filters, page: page + 1 })}`} className="btn-ghost px-3 py-1.5 text-xs">
                  下一页
                  <ChevronRight className="size-3.5" />
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
