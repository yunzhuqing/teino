"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

/** 表单里的一行价格档，字段全是字符串（numeric 列直接接收） */
export interface PriceTierValue {
  contextMin: string;
  contextMax: string;
  period: string;
  inputPrice: string;
  outputPrice: string;
  cacheWritePrice: string;
  cacheReadPrice: string;
}

const EMPTY: PriceTierValue = {
  contextMin: "0",
  contextMax: "",
  period: "all",
  inputPrice: "0",
  outputPrice: "0",
  cacheWritePrice: "0",
  cacheReadPrice: "0",
};

const COLUMNS: Array<{ key: keyof PriceTierValue; label: string; placeholder: string; width: string }> = [
  { key: "contextMin", label: "上下文起", placeholder: "0", width: "w-20" },
  { key: "contextMax", label: "上下文止", placeholder: "留空=不限", width: "w-24" },
  { key: "period", label: "时段", placeholder: "all", width: "w-20" },
  { key: "inputPrice", label: "输入", placeholder: "0", width: "w-20" },
  { key: "outputPrice", label: "输出", placeholder: "0", width: "w-20" },
  { key: "cacheWritePrice", label: "缓存创建", placeholder: "0", width: "w-20" },
  { key: "cacheReadPrice", label: "缓存命中", placeholder: "0", width: "w-20" },
];

/**
 * 价格档表格编辑器。
 *
 * 没有表单库，动态行只能自己管状态；整表序列化成 JSON 放进隐藏字段交给 server action 解析，
 * 比把每行拆成多值 FormData 更好校验（区间重叠需要跨行比较）。
 */
export function PriceTiersEditor({ name = "prices", defaultValue }: { name?: string; defaultValue?: (Partial<PriceTierValue> | null)[] }) {
  const [rows, setRows] = useState<PriceTierValue[]>(
    defaultValue?.length
      ? defaultValue.filter((r): r is Partial<PriceTierValue> => r !== null).map((r) => ({ ...EMPTY, ...r }))
      : [],
  );

  const update = (i: number, key: keyof PriceTierValue, value: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="label mb-0">价格档（单价单位：每 100 万 token）</span>
        <button type="button" className="btn-ghost h-7 px-2 text-xs" onClick={() => setRows((rs) => [...rs, { ...EMPTY, contextMin: rs.length ? "" : "0" }])}>
          <Plus className="size-3.5" />
          添加档位
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-zinc-500">
          尚未配置价格档，该模型不会被计费。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 text-zinc-400">
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-left font-medium whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-white/5 last:border-0">
                  {COLUMNS.map((c) => (
                    <td key={c.key} className="px-1 py-1">
                      <input
                        value={row[c.key]}
                        onChange={(e) => update(i, c.key, e.target.value)}
                        inputMode={c.key === "period" ? undefined : "decimal"}
                        className={`input h-8 !px-2 text-xs tabular-nums ${c.width}`}
                        placeholder={c.placeholder}
                        aria-label={`第 ${i + 1} 档 ${c.label}`}
                      />
                    </td>
                  ))}
                  <td className="px-1">
                    <button type="button" className="btn-icon size-7 text-rose-400/80" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`删除第 ${i + 1} 档`}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 整表以 JSON 提交，由 server action 统一做区间与价格校验 */}
      <input type="hidden" name={name} value={JSON.stringify(rows)} />
      <p className="mt-1.5 text-xs text-zinc-500">
        上下文区间为 [起, 止)，留空止表示不限。同一时段内区间不可重叠；时段填 all 作为兜底档，其余名称需与「计费」页的时段对应。
      </p>
    </div>
  );
}
