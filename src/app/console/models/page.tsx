import { Boxes } from "lucide-react";
import { EmptyState, formatCreditAmount, formatMoney, PageHeader, Pill } from "@/components/ui";
import { getMyModels } from "@/lib/console";
import { API_TYPE_LABELS } from "@/lib/gateway/upstream";

type ModelRow = Awaited<ReturnType<typeof getMyModels>>["models"][number];
type Price = ModelRow["prices"][number];

function formatUnit(value: number, p: Price) {
  return p.billingMode === "credit" ? `${formatCreditAmount(value)} 积分` : formatMoney(value, p.currency);
}

/** 同名模型可能挂在多个上游、价格不同，展示区间 */
function PriceCell({ prices, pick }: { prices: Price[]; pick: (p: Price) => number }) {
  if (prices.length === 0) return <span className="text-zinc-400">—</span>;
  const sorted = [...prices].sort((a, b) => pick(a) - pick(b));
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const sameUnit = lo.billingMode === hi.billingMode && lo.currency === hi.currency;
  if (pick(lo) === pick(hi) || !sameUnit) return <>{formatUnit(pick(lo), lo)}</>;
  return (
    <>
      {formatUnit(pick(lo), lo)} ~ {formatUnit(pick(hi), hi)}
    </>
  );
}

export default async function MyModelsPage() {
  const { models } = await getMyModels();

  return (
    <>
      <PageHeader title="模型" description="你的 API Key 可调用的模型。价格单位为「每 100 万 token」，已包含供应商折扣；实际费用以请求明细为准。" />
      <section className="glass overflow-hidden">
        {models.length === 0 ? (
          <EmptyState icon={<Boxes className="size-5" />} title="暂无可用模型" hint="请联系管理员开通模型访问权限。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>模型</th>
                  <th>支持的接口</th>
                  <th className="text-right">输入 /M</th>
                  <th className="text-right">输出 /M</th>
                  <th className="text-right">缓存命中 /M</th>
                  <th className="text-right">缓存创建 /M</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.name}>
                    <td>
                      <code className="font-mono text-sm">{m.name}</code>
                      {m.tiered ? <Pill className="ml-2">阶梯价</Pill> : null}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {m.apiTypes.map((t) => (
                          <Pill key={t}>{API_TYPE_LABELS[t]}</Pill>
                        ))}
                      </div>
                    </td>
                    <td className="text-right font-mono text-xs tabular-nums">
                      <PriceCell prices={m.prices} pick={(p) => p.input} />
                    </td>
                    <td className="text-right font-mono text-xs tabular-nums">
                      <PriceCell prices={m.prices} pick={(p) => p.output} />
                    </td>
                    <td className="text-right font-mono text-xs tabular-nums text-zinc-600">
                      <PriceCell prices={m.prices} pick={(p) => p.cacheRead} />
                    </td>
                    <td className="text-right font-mono text-xs tabular-nums text-zinc-600">
                      <PriceCell prices={m.prices} pick={(p) => p.cacheWrite} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="mt-3 text-xs text-zinc-500">阶梯价：长上下文或高峰时段按更高的档位计费，表中为基础档价格。也可以通过 GET /v1/models 获取模型列表。</p>
    </>
  );
}
