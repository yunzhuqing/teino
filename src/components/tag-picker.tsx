"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { TagLite } from "./tag-badge";

/** 多选标签，以 name="tagIds" 的隐藏 checkbox 提交 */
export function TagPicker({ tags, defaultValue = [] }: { tags: TagLite[]; defaultValue?: readonly string[] }) {
  const [selected, setSelected] = useState(() => new Set(defaultValue));

  if (tags.length === 0) {
    return <p className="text-xs text-zinc-500">暂无标签，可在“标签”页面创建。</p>;
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => {
        const on = selected.has(t.id);
        return (
          <label
            key={t.id}
            className="inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition select-none"
            style={
              on
                ? {
                    color: `color-mix(in oklab, ${t.color} 62%, black)`,
                    borderColor: `color-mix(in oklab, ${t.color} 40%, transparent)`,
                    backgroundColor: `color-mix(in oklab, ${t.color} 16%, transparent)`,
                  }
                : { color: "#71717a", borderColor: "rgba(24,24,27,0.12)", backgroundColor: "rgba(255,255,255,0.6)" }
            }
          >
            <input type="checkbox" name="tagIds" value={t.id} checked={on} onChange={() => toggle(t.id)} className="sr-only" />
            {on ? <Check className="size-3" /> : <span className="size-1.5 rounded-full" style={{ backgroundColor: t.color }} />}
            {t.name}
          </label>
        );
      })}
    </div>
  );
}
