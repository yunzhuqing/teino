import { KeyRound, Pencil, Plus } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { DeleteButton, ToggleSwitch } from "@/components/row-actions";
import { EmptyState, formatCreditAmount, formatDate, PageHeader } from "@/components/ui";
import { createMyApiKey, deleteMyApiKey, toggleMyApiKey, updateMyApiKey } from "@/lib/actions/my-keys";
import { getMyKeys } from "@/lib/console";
import { DEFAULT_UTC_OFFSET_MINUTES } from "@/lib/timezone";

type KeyRow = Awaited<ReturnType<typeof getMyKeys>>[number];

function toLocalInput(d: Date | null): string {
  if (!d) return "";
  return new Date(d.getTime() + DEFAULT_UTC_OFFSET_MINUTES * 60 * 1000).toISOString().slice(0, 16); // Asia/Shanghai
}

function KeyFields({ apiKey }: { apiKey?: KeyRow }) {
  return (
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
        <input id="k-exp" name="expiresAt" type="datetime-local" defaultValue={toLocalInput(apiKey?.expiresAt ?? null)} className="input [color-scheme:light]" />
      </div>
    </div>
  );
}

export default async function MyKeysPage() {
  const keys = await getMyKeys();
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="API Keys"
        description="通过 Authorization: Bearer <key> 或 x-api-key 调用网关。积分余额挂在每个 Key 上，充值请联系管理员。"
        action={
          <FormDialog title="创建 API Key" action={createMyApiKey} submitLabel="生成" trigger={<><Plus className="size-4" />创建 Key</>}>
            <KeyFields />
          </FormDialog>
        }
      />
      <section className="glass overflow-hidden">
        {keys.length === 0 ? (
          <EmptyState icon={<KeyRound className="size-5" />} title="还没有 API Key" hint="点击右上角创建第一个 Key，完整密钥只会显示一次。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>Key</th>
                  <th className="text-right">积分余额</th>
                  <th>状态</th>
                  <th>最近使用</th>
                  <th>过期</th>
                  <th>创建时间</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const expired = k.expiresAt ? k.expiresAt.getTime() < now : false;
                  const balance = Number(k.creditBalance);
                  return (
                    <tr key={k.id}>
                      <td className="font-medium">{k.name}</td>
                      <td>
                        <code className="rounded-md bg-white/70 px-1.5 py-0.5 font-mono text-xs text-zinc-700 ring-1 ring-zinc-900/8">{k.keyPrefix}</code>
                      </td>
                      <td className={`text-right font-mono text-sm tabular-nums ${balance <= 0 ? "text-rose-600" : "text-zinc-800"}`}>{formatCreditAmount(k.creditBalance)}</td>
                      <td>
                        <ToggleSwitch enabled={k.enabled} onToggle={toggleMyApiKey.bind(null, k.id)} label="启用 Key" />
                      </td>
                      <td className="text-xs text-zinc-500">{formatDate(k.lastUsedAt)}</td>
                      <td className={`text-xs ${expired ? "text-rose-600" : "text-zinc-500"}`}>{k.expiresAt ? formatDate(k.expiresAt) : "永不"}</td>
                      <td className="text-xs text-zinc-500">{formatDate(k.createdAt)}</td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <FormDialog title="编辑 API Key" action={updateMyApiKey.bind(null, k.id)} triggerClassName="btn-icon" triggerLabel="编辑" trigger={<Pencil className="size-4" />}>
                            <KeyFields apiKey={k} />
                          </FormDialog>
                          <DeleteButton onDelete={deleteMyApiKey.bind(null, k.id)} confirmText={`吊销并删除 Key「${k.name}」？使用该 Key 的服务将立即无法调用。`} />
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
