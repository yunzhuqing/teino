"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

interface Row {
  tier: string;
  multiplier: string;
}

/**
 * 请求优先级档位 → 价格倍率。
 *
 * 这里的「优先级」指请求声明的档位（body 的 service_tier / priority，或 x-gateway-priority 头），
 * 与模型表单里的「优先级」（路由用的数值）是两个不同概念，UI 文案上要区分清楚。
 */
export function PriorityMultipliersEditor({ name = "priorityMultipliers", defaultValue }: { name?: string; defaultValue?: Record<string, number> }) {
  const [rows, setRows] = useState<Row[]>(() =>
    Object.entries(defaultValue ?? {}).map(([tier, multiplier]) => ({ tier, multiplier: String(multiplier) })),
  );

  const update = (i: number, key: keyof Row, value: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  // 未填写的行不提交；重复档位后者覆盖前者
  const serialized = JSON.stringify(
    Object.fromEntries(rows.filter((r) => r.tier.trim()).map((r) => [r.tier.trim(), r.multiplier === "" ? 1 : Number(r.multiplier)])),
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="label mb-0">请求优先级倍率（可选）</span>
        <button type="button" className="btn-ghost h-7 px-2 text-xs" onClick={() => setRows((rs) => [...rs, { tier: "", multiplier: "1" }])}>
          <Plus className="size-3.5" />
          添加档位
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-900/15 bg-white/40 px-3 py-3 text-xs text-zinc-500">
          未配置时所有请求按 1 倍计价。
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={row.tier}
                onChange={(e) => update(i, "tier", e.target.value)}
                className="input h-8 flex-1 !px-2 text-xs"
                placeholder="档位名，如 priority / batch / standard"
                aria-label={`第 ${i + 1} 个档位名`}
              />
              <span className="text-xs text-zinc-500">×</span>
              <input
                value={row.multiplier}
                onChange={(e) => update(i, "multiplier", e.target.value)}
                inputMode="decimal"
                className="input h-8 w-20 !px-2 text-xs tabular-nums"
                placeholder="1"
                aria-label={`第 ${i + 1} 个倍率`}
              />
              <button type="button" className="btn-icon size-7 text-rose-500/80 hover:bg-rose-500/10 hover:text-rose-600" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`删除第 ${i + 1} 个档位`}>
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <input type="hidden" name={name} value={serialized} />
      <p className="mt-1.5 text-xs text-zinc-500">
        档位取自请求体的 <code className="font-mono">service_tier</code> / <code className="font-mono">priority</code> 字段或 <code className="font-mono">x-gateway-priority</code> 头；
        未声明的档位按 1 倍计价。这与上方「优先级」（决定路由顺序）无关。
      </p>
    </div>
  );
}
