import { Pencil, Plus, Tags as TagsIcon } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { DeleteButton } from "@/components/row-actions";
import { TagBadge } from "@/components/tag-badge";
import { EmptyState, PageHeader, Pill } from "@/components/ui";
import { createTag, deleteTag, updateTag } from "@/lib/actions/tags";
import type { Tag } from "@/lib/db/schema";
import { getTags, getTagUsage } from "@/lib/queries";

const PALETTE = ["#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#a3e635"];
const USAGE_LABELS = { provider: "供应商", model: "模型", user: "用户", api_key: "Key" } as const;

function TagFields({ tag }: { tag?: Tag }) {
  return (
    <>
      <div>
        <label className="label" htmlFor="tag-name">
          标签名
        </label>
        <input id="tag-name" name="name" required defaultValue={tag?.name} className="input" placeholder="如 vip、cn、low-cost" />
      </div>
      <div>
        <span className="label">颜色</span>
        <div className="flex flex-wrap items-center gap-2">
          {PALETTE.map((c, i) => (
            <label key={c} className="cursor-pointer">
              <input type="radio" name="color" value={c} defaultChecked={tag ? tag.color === c : i === 0} className="peer sr-only" />
              <span className="block size-7 rounded-full ring-offset-2 ring-offset-zinc-900 transition peer-checked:ring-2 peer-checked:ring-white/80" style={{ backgroundColor: c }} />
            </label>
          ))}
          {tag && !PALETTE.includes(tag.color) ? <input type="radio" name="color" value={tag.color} defaultChecked className="hidden" /> : null}
        </div>
      </div>
      <div>
        <label className="label" htmlFor="tag-desc">
          描述
        </label>
        <input id="tag-desc" name="description" defaultValue={tag?.description ?? ""} className="input" placeholder="可选" />
      </div>
    </>
  );
}

export default async function TagsPage() {
  const [tags, usage] = await Promise.all([getTags(), getTagUsage()]);

  return (
    <>
      <PageHeader
        title="标签"
        description="为供应商、模型、用户与 API Key 打标签。调用方（Key ∪ 用户）的标签需与上游（供应商 ∪ 模型）的标签有交集才会被路由。"
        action={
          <FormDialog title="新建标签" action={createTag} trigger={<><Plus className="size-4" />新建标签</>}>
            <TagFields />
          </FormDialog>
        }
      />
      <section className="glass overflow-hidden">
        {tags.length === 0 ? (
          <EmptyState icon={<TagsIcon className="size-5" />} title="还没有标签" hint="创建标签后即可在各实体上使用，实现按标签路由。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>标签</th>
                  <th>描述</th>
                  <th>使用情况</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {tags.map((t) => {
                  const u = usage[t.id] ?? {};
                  const entries = Object.entries(USAGE_LABELS).filter(([k]) => u[k as keyof typeof u]);
                  return (
                    <tr key={t.id}>
                      <td>
                        <TagBadge tag={t} />
                      </td>
                      <td className="text-zinc-400">{t.description ?? "—"}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {entries.length === 0 ? <span className="text-xs text-zinc-600">未使用</span> : null}
                          {entries.map(([k, label]) => (
                            <Pill key={k}>
                              {label} · {u[k as keyof typeof u]}
                            </Pill>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <FormDialog title="编辑标签" action={updateTag.bind(null, t.id)} triggerClassName="btn-icon" triggerLabel="编辑" trigger={<Pencil className="size-4" />}>
                            <TagFields tag={t} />
                          </FormDialog>
                          <DeleteButton onDelete={deleteTag.bind(null, t.id)} confirmText={`删除标签「${t.name}」？相关关联将被移除。`} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
