import { Pencil, Plus, Server } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { DeleteButton, ToggleSwitch } from "@/components/row-actions";
import { TagList } from "@/components/tag-badge";
import { EmptyState, PageHeader, Pill } from "@/components/ui";
import { createModel } from "@/lib/actions/models";
import { createProvider, deleteProvider, toggleProvider, updateProvider } from "@/lib/actions/providers";
import { API_TYPE_LABELS } from "@/lib/gateway/upstream";
import { getProvidersWithModels, getTags } from "@/lib/queries";
import { ModelFields, ProviderFields } from "./fields";
import { ModelTable } from "./model-table";
import { RoutingOverview } from "./routing-overview";

export default async function ProvidersPage() {
  const [providers, tags] = await Promise.all([getProvidersWithModels(), getTags()]);
  const tagMap = new Map(tags.map((t) => [t.id, t]));

  return (
    <>
      <PageHeader
        title="供应商与模型"
        description="同名模型可配置在多个供应商下：优先级高的先分发，同优先级内按权重比例分配流量，失败时自动降级。"
        action={
          <FormDialog title="添加供应商" wide action={createProvider} trigger={<><Plus className="size-4" />添加供应商</>}>
            <ProviderFields tags={tags} />
          </FormDialog>
        }
      />

      <RoutingOverview providers={providers} />

      {providers.length === 0 ? (
        <section className="glass">
          <EmptyState icon={<Server className="size-5" />} title="还没有供应商" hint="添加 OpenAI、Anthropic 或任何兼容 API 的上游服务。" />
        </section>
      ) : (
        <div className="space-y-5">
          {providers.map((p) => (
            <section key={p.id} className={`glass overflow-hidden transition ${p.enabled ? "" : "opacity-60"}`}>
              <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 p-5">
                <div className="min-w-0 space-y-2">
                  <div className="flex items-center gap-3">
                    <h2 className="text-base font-semibold">{p.name}</h2>
                    <ToggleSwitch enabled={p.enabled} onToggle={toggleProvider.bind(null, p.id)} label="启用供应商" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    <code className="font-mono">{p.baseUrl}</code>
                    <span className="text-zinc-600">·</span>
                    <code className="font-mono">{p.apiKeyHint}</code>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {p.apiTypes.map((t) => (
                      <Pill key={t} className="border-sky-400/20 bg-sky-500/10 text-sky-200">
                        {API_TYPE_LABELS[t]}
                      </Pill>
                    ))}
                    {p.tagIds.length > 0 ? <TagList ids={p.tagIds} tags={tagMap} /> : null}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <FormDialog title={`添加模型 · ${p.name}`} action={createModel} triggerClassName="btn-ghost py-1.5 text-xs" trigger={<><Plus className="size-3.5" />模型</>}>
                    <ModelFields providerId={p.id} providerApiTypes={p.apiTypes} tags={tags} />
                  </FormDialog>
                  <FormDialog title="编辑供应商" wide action={updateProvider.bind(null, p.id)} triggerClassName="btn-icon" triggerLabel="编辑" trigger={<Pencil className="size-4" />}>
                    <ProviderFields provider={p} tags={tags} />
                  </FormDialog>
                  <DeleteButton onDelete={deleteProvider.bind(null, p.id)} confirmText={`删除供应商「${p.name}」及其全部模型？`} />
                </div>
              </header>
              <ModelTable providerId={p.id} providerApiTypes={p.apiTypes} models={p.models} tags={tags} tagMap={tagMap} />
            </section>
          ))}
        </div>
      )}
    </>
  );
}
