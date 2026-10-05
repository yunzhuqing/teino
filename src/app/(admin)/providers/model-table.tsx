import { Boxes, Pencil } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { DeleteButton, ToggleSwitch } from "@/components/row-actions";
import { TagList, type TagLite } from "@/components/tag-badge";
import { EmptyState, Pill } from "@/components/ui";
import { deleteModel, toggleModel, updateModel } from "@/lib/actions/models";
import type { ApiType } from "@/lib/db/schema";
import { API_TYPE_LABELS } from "@/lib/gateway/upstream";
import type { getProvidersWithModels } from "@/lib/queries";
import { ModelFields } from "./fields";

type ModelRow = Awaited<ReturnType<typeof getProvidersWithModels>>[number]["models"][number];

export function ModelTable({
  providerId,
  providerApiTypes,
  models,
  tags,
  tagMap,
}: {
  providerId: string;
  providerApiTypes: ApiType[];
  models: ModelRow[];
  tags: TagLite[];
  tagMap: Map<string, TagLite>;
}) {
  if (models.length === 0) {
    return <EmptyState icon={<Boxes className="size-5" />} title="暂无模型" hint="添加模型后，请求中的 model 字段将匹配到此供应商。" />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>模型</th>
            <th>上游模型</th>
            <th>上游协议</th>
            <th>优先级</th>
            <th>权重</th>
            <th>标签</th>
            <th>状态</th>
            <th className="w-24" />
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.id}>
              <td className="font-mono text-[13px] font-medium">{m.name}</td>
              <td className="font-mono text-xs text-zinc-400">{m.upstreamModel ?? "—"}</td>
              <td>
                {m.apiType ? (
                  <Pill className="border-sky-400/20 bg-sky-500/10 text-sky-200">{API_TYPE_LABELS[m.apiType]}</Pill>
                ) : (
                  <span className="text-xs text-zinc-500">沿用请求</span>
                )}
              </td>
              <td>
                <span className="inline-flex min-w-8 justify-center rounded-md bg-violet-500/15 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-violet-200">{m.priority}</span>
              </td>
              <td className="tabular-nums text-zinc-300">
                {m.weight}
                {m.weight === 0 ? <span className="ml-1.5 text-xs text-zinc-500">兜底</span> : null}
              </td>
              <td>
                <TagList ids={m.tagIds} tags={tagMap} />
              </td>
              <td>
                <ToggleSwitch enabled={m.enabled} onToggle={toggleModel.bind(null, m.id)} label="启用模型" />
              </td>
              <td>
                <div className="flex justify-end gap-1">
                  <FormDialog title="编辑模型" action={updateModel.bind(null, m.id)} triggerClassName="btn-icon" triggerLabel="编辑" trigger={<Pencil className="size-4" />}>
                    <ModelFields providerId={providerId} providerApiTypes={providerApiTypes} model={m} tags={tags} />
                  </FormDialog>
                  <DeleteButton onDelete={deleteModel.bind(null, m.id)} confirmText={`删除模型「${m.name}」？`} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
