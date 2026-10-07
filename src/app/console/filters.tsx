import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";
import { Search } from "lucide-react";
import type { DateRange } from "@/lib/date-range";

/**
 * GET 表单筛选：条件落在 URL 上，可分享、可刷新、可前进后退。
 * next/form 提交时做客户端导航，不整页刷新。
 */
export function FilterBar({ action, range, children, resetHref }: { action: string; range: DateRange; children?: ReactNode; resetHref: string }) {
  return (
    <Form action={action} className="glass mb-5 flex flex-wrap items-end gap-3 p-4">
      <div>
        <label className="label" htmlFor="f-from">
          开始日期
        </label>
        <input id="f-from" name="from" type="date" defaultValue={range.from} className="input py-2 [color-scheme:light]" />
      </div>
      <div>
        <label className="label" htmlFor="f-to">
          结束日期
        </label>
        <input id="f-to" name="to" type="date" defaultValue={range.to} className="input py-2 [color-scheme:light]" />
      </div>
      {children}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">
          <Search className="size-4" />
          查询
        </button>
        <Link href={resetHref} className="btn-ghost">
          重置
        </Link>
      </div>
    </Form>
  );
}

export function FilterSelect({ id, name, label, value, options, allLabel }: { id: string; name: string; label: string; value?: string; options: { value: string; label: string }[]; allLabel: string }) {
  return (
    <div className="min-w-40">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} name={name} defaultValue={value ?? ""} className="input py-2">
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 只保留非空参数，生成干净的查询串 */
export function buildQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
