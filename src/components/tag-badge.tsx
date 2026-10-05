import type { Tag } from "@/lib/db/schema";

export type TagLite = Pick<Tag, "id" | "name" | "color">;

export function TagBadge({ tag }: { tag: TagLite }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ color: tag.color, borderColor: `${tag.color}55`, backgroundColor: `${tag.color}1a` }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
      {tag.name}
    </span>
  );
}

export function TagList({ ids, tags }: { ids: readonly string[]; tags: Map<string, TagLite> }) {
  if (ids.length === 0) return <span className="text-xs text-zinc-600">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => {
        const t = tags.get(id);
        return t ? <TagBadge key={id} tag={t} /> : null;
      })}
    </div>
  );
}
