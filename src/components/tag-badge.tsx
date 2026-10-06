import type { Tag } from "@/lib/db/schema";

export type TagLite = Pick<Tag, "id" | "name" | "color">;

export function TagBadge({ tag }: { tag: TagLite }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      // 标签色取自用户配置，浅色底上直接用会偏亮（如 lime / amber），统一往黑色方向压暗作为文字色
      style={{
        color: `color-mix(in oklab, ${tag.color} 62%, black)`,
        borderColor: `color-mix(in oklab, ${tag.color} 30%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${tag.color} 14%, transparent)`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
      {tag.name}
    </span>
  );
}

export function TagList({ ids, tags }: { ids: readonly string[]; tags: Map<string, TagLite> }) {
  if (ids.length === 0) return <span className="text-xs text-zinc-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => {
        const t = tags.get(id);
        return t ? <TagBadge key={id} tag={t} /> : null;
      })}
    </div>
  );
}
