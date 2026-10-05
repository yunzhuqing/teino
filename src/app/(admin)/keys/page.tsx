import { KeyRound, Pencil, Plus } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { DeleteButton, ToggleSwitch } from "@/components/row-actions";
import { TagList, type TagLite } from "@/components/tag-badge";
import { TagPicker } from "@/components/tag-picker";
import { EmptyState, formatDate, PageHeader } from "@/components/ui";
import { createApiKey, deleteApiKey, toggleApiKey, updateApiKey } from "@/lib/actions/api-keys";
import { getApiKeys, getTags, getUserOptions } from "@/lib/queries";

type KeyRow = Awaited<ReturnType<typeof getApiKeys>>[number];

function toLocalInput(d: Date | null): string {
  if (!d) return "";
  const local = new Date(d.getTime() + 8 * 60 * 60 * 1000); // Asia/Shanghai
  return local.toISOString().slice(0, 16);
}

function KeyFields({ apiKey, tags, users }: { apiKey?: KeyRow; tags: TagLite[]; users?: { id: string; name: string }[] }) {
  return (
    <>
      {users ? (
        <div>
          <label className="label" htmlFor="k-user">
            所属用户
          </label>
          <select id="k-user" name="userId" required className="input" defaultValue="">
            <option value="" disabled>
              选择用户
            </option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="k-name">
            名称
          </label>
          <input id="k-name" name="name" required defaultValue={apiKey?.name} className="input" placeholder="如 prod-backend" />
        </div>
        <div>
          <label className="label" htmlFor="k-exp">
            过期时间（北京时间，可选）
          </label>
          <input id="k-exp" name="expiresAt" type="datetime-local" defaultValue={toLocalInput(apiKey?.expiresAt ?? null)} className="input [color-scheme:dark]" />
        </div>
      </div>
      <div>
        <span className="label">标签</span>
        <TagPicker tags={tags} defaultValue={apiKey?.tagIds} />
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" name="enabled" defaultChecked={apiKey?.enabled ?? true} className="size-4 accent-violet-500" />
        启用
      </label>
    </>
  );
}

export default async function KeysPage() {
  const [keys, tags, users] = await Promise.all([getApiKeys(), getTags(), getUserOptions()]);
  const tagMap = new Map(tags.map((t) => [t.id, t]));
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="API Keys"
        description="调用方通过 Authorization: Bearer <key> 或 x-api-key 访问网关。Key 仅以哈希形式存储。"
        action={
          users.length > 0 ? (
            <FormDialog title="签发 API Key" action={createApiKey} submitLabel="生成" trigger={<><Plus className="size-4" />签发 Key</>}>
              <KeyFields tags={tags} users={users} />
            </FormDialog>
          ) : null
        }
      />
      <section className="glass overflow-hidden">
        {keys.length === 0 ? (
          <EmptyState icon={<KeyRound className="size-5" />} title="还没有 API Key" hint={users.length ? "点击右上角签发第一个 Key。" : "请先在“用户”页面创建用户。"} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>Key</th>
                  <th>用户</th>
                  <th>标签</th>
                  <th>状态</th>
                  <th>最近使用</th>
                  <th>过期</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const expired = k.expiresAt ? k.expiresAt.getTime() < now : false;
                  return (
                    <tr key={k.id}>
                      <td className="font-medium">{k.name}</td>
                      <td>
                        <code className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-xs text-zinc-300">{k.keyPrefix}</code>
                      </td>
                      <td className="text-zinc-300">{k.userName}</td>
                      <td>
                        <TagList ids={k.tagIds} tags={tagMap} />
                      </td>
                      <td>
                        <ToggleSwitch enabled={k.enabled} onToggle={toggleApiKey.bind(null, k.id)} label="启用 Key" />
                      </td>
                      <td className="text-xs text-zinc-400">{formatDate(k.lastUsedAt)}</td>
                      <td className={`text-xs ${expired ? "text-rose-400" : "text-zinc-400"}`}>{k.expiresAt ? formatDate(k.expiresAt) : "永不"}</td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <FormDialog title="编辑 API Key" action={updateApiKey.bind(null, k.id)} triggerClassName="btn-icon" triggerLabel="编辑" trigger={<Pencil className="size-4" />}>
                            <KeyFields apiKey={k} tags={tags} />
                          </FormDialog>
                          <DeleteButton onDelete={deleteApiKey.bind(null, k.id)} confirmText={`吊销并删除 Key「${k.name}」？`} />
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
