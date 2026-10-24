import { formatMoney } from "@/components/ui";
import type { getMyModels } from "@/lib/console";

export type ModelRow = Awaited<ReturnType<typeof getMyModels>>["models"][number];
type Unit = { billingMode: string; currency: string | null };

export function formatModelPrice(value: number, unit: Unit) {
  if (unit.billingMode === "credit") return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 8 }).format(value)} 积分`;
  return formatMoney(value, unit.currency);
}

export function discountLabel(discount: number) {
  if (discount === 1) return "标准价";
  if (discount < 1) return `${Number((discount * 10).toFixed(2))} 折`;
  return `${Number(discount.toFixed(4))} 倍价格`;
}

export function PriceRange({ prices, dimension }: { prices: ModelRow["prices"]; dimension: "input" | "output" }) {
  if (!prices.length) return <span className="text-zinc-400">暂未定价</span>;
  const groups = new Map<string, typeof prices>();
  for (const p of prices) {
    const key = `${p.billingMode}:${p.currency}`;
    const group = groups.get(key);
    if (group) group.push(p);
    else groups.set(key, [p]);
  }
  return <>{[...groups].map(([key, group]) => {
    const values = group.map((p) => p[dimension]);
    const low = Math.min(...values);
    const high = Math.max(...values);
    return <span key={key} className="block">{formatModelPrice(low, group[0])}{high !== low ? ` – ${formatModelPrice(high, group[0])}` : ""}</span>;
  })}</>;
}
