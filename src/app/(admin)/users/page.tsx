import { Pencil, Plus, Users as UsersIcon } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { DeleteButton, ToggleSwitch } from "@/components/row-actions";
import { TagList, type TagLite } from "@/components/tag-badge";
import { TagPicker } from "@/components/tag-picker";
import { EmptyState, formatDate, PageHeader } from "@/components/ui";
import { createUser, deleteUser, toggleUser, updateUser } from "@/lib/actions/users";
import { getTags, getUsers } from "@/lib/queries";

type UserRow = Awaited<ReturnType<typeof getUsers>>[number];

function UserFields({ user, tags }: { user?: UserRow; tags: TagLite[] }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="u-name">
            名称
          </label>
          <input id="u-name" name="name" required defaultValue={user?.name} className="input" placeholder="团队或个人名称" />
        </div>
        <div>
          <label className="label" htmlFor="u-email">
            邮箱
          </label>
          <input id="u-email" name="email" type="email" defaultValue={user?.email ?? ""} className="input" placeholder="可选" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="u-password">
          控制台登录密码
        </label>
        <input id="u-password" name="password" type="password" autoComplete="new-password" minLength={8} className="input" placeholder={user?.canLogin ? "留空则不修改" : "可选，至少 8 位"} />
        <p className="mt-1 text-xs text-zinc-500">设置后，用户可用邮箱 + 密码登录控制台，自助管理 Key、查看用量与请求明细。</p>
      </div>
      <div>
        <label className="label" htmlFor="u-note">
          备注
        </label>
        <input id="u-note" name="note" defaultValue={user?.note ?? ""} className="input" placeholder="可选" />
      </div>
      <div>
        <span className="label">标签</span>
        <TagPicker tags={tags} defaultValue={user?.tagIds} />
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input type="checkbox" name="enabled" defaultChecked={user?.enabled ?? true} className="size-4 accent-violet-500" />
        启用
      </label>
    </>
  );
}

export default async function UsersPage() {
  const [users, tags] = await Promise.all([getUsers(), getTags()]);
  const tagMap = new Map(tags.map((t) => [t.id, t]));

  return (
    <>
      <PageHeader
        title="用户"
        description="用户拥有 API Key；用户标签会与其 Key 的标签合并参与路由。停用用户后其所有 Key 与控制台登录失效。"
        action={
          <FormDialog title="新建用户" action={createUser} trigger={<><Plus className="size-4" />新建用户</>}>
            <UserFields tags={tags} />
          </FormDialog>
        }
      />
      <section className="glass overflow-hidden">
        {users.length === 0 ? (
          <EmptyState icon={<UsersIcon className="size-5" />} title="还没有用户" hint="先创建用户，再为其签发 API Key。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>标签</th>
                  <th>Keys</th>
                  <th>控制台</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="font-medium">{u.name}</div>
                      <div className="text-xs text-zinc-500">{u.email ?? u.note ?? ""}</div>
                    </td>
                    <td>
                      <TagList ids={u.tagIds} tags={tagMap} />
                    </td>
                    <td className="tabular-nums text-zinc-700">{u.keyCount}</td>
                    <td className="text-xs">{u.canLogin && u.email ? <span className="text-emerald-600">可登录</span> : <span className="text-zinc-400">未开通</span>}</td>
                    <td>
                      <ToggleSwitch enabled={u.enabled} onToggle={toggleUser.bind(null, u.id)} label="启用用户" />
                    </td>
                    <td className="text-xs text-zinc-500">{formatDate(u.createdAt)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <FormDialog title="编辑用户" action={updateUser.bind(null, u.id)} triggerClassName="btn-icon" triggerLabel="编辑" trigger={<Pencil className="size-4" />}>
                          <UserFields user={u} tags={tags} />
                        </FormDialog>
                        <DeleteButton onDelete={deleteUser.bind(null, u.id)} confirmText={`删除用户「${u.name}」及其全部 API Key？`} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
