import { Coins, Pencil, Plus, Timer } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { DeleteButton, ToggleSwitch } from "@/components/row-actions";
import { EmptyState, PageHeader, Pill } from "@/components/ui";
import { deletePeriod, togglePeriod, upsertCurrency, upsertPeriod } from "@/lib/actions/billing";
import type { BillingPeriod, Currency } from "@/lib/db/schema";
import { getBillingPeriods, getCurrencies } from "@/lib/queries";
import { minutesToHHMM } from "@/lib/timezone";

const CURRENCY_LABELS: Record<string, string> = { USD: "美元", CNY: "人民币" };

function CurrencyFields({ currency }: { currency?: Currency }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="c-code">
            币种
          </label>
          <select id="c-code" name="code" defaultValue={currency?.code ?? "USD"} className="input" disabled={Boolean(currency)}>
            <option value="USD">USD（美元）</option>
            <option value="CNY">CNY（人民币）</option>
          </select>
          {/* 币种是主键，编辑时不允许改；禁用控件不会提交，所以补一个隐藏字段 */}
          {currency ? <input type="hidden" name="code" value={currency.code} /> : null}
        </div>
        <div>
          <label className="label" htmlFor="c-label">
            显示名
          </label>
          <input id="c-label" name="label" required defaultValue={currency?.label ?? CURRENCY_LABELS.USD} className="input" placeholder="美元" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="c-rate">
          折主货币汇率
        </label>
        <input
          id="c-rate"
          name="rateToBase"
          required
          inputMode="decimal"
          defaultValue={currency?.rateToBase ?? "1"}
          className="input tabular-nums"
          placeholder="如 0.14 表示 1 CNY = 0.14 主货币"
        />
        <p className="mt-1 text-xs text-zinc-500">1 单位本币种等于多少主货币。主货币自身填 1。</p>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" name="isBase" defaultChecked={currency?.isBase ?? false} className="size-4 accent-violet-500" />
        设为主货币
      </label>
      <div>
        <label className="label" htmlFor="c-credit">
          积分汇率（仅主货币需要）
        </label>
        <input
          id="c-credit"
          name="creditRate"
          inputMode="decimal"
          defaultValue={currency?.creditRate ?? ""}
          className="input tabular-nums"
          placeholder="如 100 表示 1 主货币 = 100 积分"
        />
        <p className="mt-1 text-xs text-zinc-500">
          按 token 计费的模型会先折成主货币，再按此换率扣积分。留空表示不接受积分结算，这类模型的请求将不会被扣费（后台会记录告警）。
        </p>
      </div>
    </>
  );
}

function PeriodFields({ period }: { period?: BillingPeriod }) {
  return (
    <>
      <div>
        <label className="label" htmlFor="per-name">
          时段名
        </label>
        <input id="per-name" name="name" required defaultValue={period?.name} className="input" placeholder="如 peak、off-peak" />
        <p className="mt-1 text-xs text-zinc-500">价格档的「时段」列填这个名字即可生效；all 是内置兜底档，不需要也不允许建。</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="per-start">
            开始时间
          </label>
          <input
            id="per-start"
            name="startMinute"
            type="time"
            required
            defaultValue={minutesToHHMM(period?.startMinute ?? 540)}
            className="input tabular-nums"
          />
        </div>
        <div>
          <label className="label" htmlFor="per-end">
            结束时间
          </label>
          <input
            id="per-end"
            name="endMinute"
            type="time"
            required
            defaultValue={minutesToHHMM(period?.endMinute ?? 1080)}
            className="input tabular-nums"
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-zinc-500">含开始、不含结束。开始晚于结束表示跨午夜（如 22:00–06:00）。</p>
      <div>
        <label className="label" htmlFor="per-tz">
          时区
        </label>
        <input id="per-tz" name="timezone" required defaultValue={period?.timezone ?? "Asia/Shanghai"} className="input font-mono" placeholder="Asia/Shanghai" />
        <p className="mt-1 text-xs text-zinc-500">IANA 时区名。按此时区判定「现在属于哪个时段」，与服务器所在时区无关。</p>
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" name="enabled" defaultChecked={period?.enabled ?? true} className="size-4 accent-violet-500" />
        启用
      </label>
    </>
  );
}

export default async function BillingPage() {
  const [currencies, periods] = await Promise.all([getCurrencies(), getBillingPeriods()]);
  const base = currencies.find((c) => c.isBase);

  return (
    <>
      <PageHeader
        title="计费"
        description="配置币种汇率与计费时段。价格档在「供应商与模型」里按模型设置，费用以模型原币记录，展示时折算成主货币。"
      />

      <div className="space-y-6">
        <section className="glass overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
            <div className="flex items-center gap-2">
              <Coins className="size-4 text-violet-300" />
              <h2 className="text-sm font-medium">币种与汇率</h2>
              {base ? <Pill>主货币 {base.code}</Pill> : <Pill className="text-amber-300">未设置主货币</Pill>}
            </div>
            <FormDialog title="新增 / 更新币种" action={upsertCurrency} trigger={<><Plus className="size-4" />配置币种</>} triggerClassName="btn-ghost h-8 px-3 text-xs">
              <CurrencyFields />
            </FormDialog>
          </div>
          {currencies.length === 0 ? (
            <EmptyState icon={<Coins className="size-5" />} title="还没有配置币种" hint="至少配置一个主货币，并填写积分汇率，按 token 计费的模型才能扣减积分。" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>币种</th>
                    <th>折主货币汇率</th>
                    <th>积分汇率</th>
                    <th>主货币</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {currencies.map((c) => (
                    <tr key={c.code}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{c.code}</span>
                          <span className="text-xs text-zinc-500">{c.label}</span>
                        </div>
                      </td>
                      <td className="font-mono text-sm tabular-nums">{c.rateToBase}</td>
                      <td className="font-mono text-sm tabular-nums">{c.creditRate ?? <span className="text-zinc-600">未配置</span>}</td>
                      <td>{c.isBase ? <Pill className="border-violet-400/30 text-violet-200">主货币</Pill> : <span className="text-xs text-zinc-600">—</span>}</td>
                      <td>
                        <div className="flex justify-end">
                          <FormDialog title="编辑币种" action={upsertCurrency} triggerClassName="btn-icon" triggerLabel="编辑" trigger={<Pencil className="size-4" />}>
                            <CurrencyFields currency={c} />
                          </FormDialog>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="glass overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
            <div className="flex items-center gap-2">
              <Timer className="size-4 text-violet-300" />
              <h2 className="text-sm font-medium">计费时段</h2>
            </div>
            <FormDialog
              title="新建时段"
              description="时段用于「高峰/低谷」这类差异化定价"
              action={upsertPeriod}
              trigger={<><Plus className="size-4" />新建时段</>}
              triggerClassName="btn-ghost h-8 px-3 text-xs"
            >
              <PeriodFields />
            </FormDialog>
          </div>
          {periods.length === 0 ? (
            <EmptyState
              icon={<Timer className="size-5" />}
              title="还没有计费时段"
              hint="不配置时段时，所有请求都命中价格档里的 all 兜底档。需要分时段定价时再来这里添加。"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>时段名</th>
                    <th>时间范围</th>
                    <th>时区</th>
                    <th>状态</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p) => (
                    <tr key={p.id}>
                      <td className="font-mono text-sm">{p.name}</td>
                      <td className="tabular-nums">
                        {minutesToHHMM(p.startMinute)} – {minutesToHHMM(p.endMinute)}
                        {p.startMinute > p.endMinute ? <span className="ml-2 text-xs text-zinc-500">跨午夜</span> : null}
                      </td>
                      <td className="font-mono text-xs text-zinc-400">{p.timezone}</td>
                      <td>
                        <ToggleSwitch enabled={p.enabled} onToggle={togglePeriod.bind(null, p.id)} label={`${p.enabled ? "停用" : "启用"}时段 ${p.name}`} />
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <FormDialog title="编辑时段" action={upsertPeriod} triggerClassName="btn-icon" triggerLabel="编辑" trigger={<Pencil className="size-4" />}>
                            <PeriodFields period={p} />
                          </FormDialog>
                          <DeleteButton onDelete={deletePeriod.bind(null, p.id)} confirmText={`删除时段「${p.name}」？使用该时段的价格档将回落到 all 兜底档。`} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="glass p-5">
          <h2 className="text-sm font-medium">计费规则</h2>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-zinc-400">
            <li>
              <span className="text-zinc-300">计价维度</span>：输入、输出、缓存创建、缓存命中四个维度，各自乘以对应 token 数后求和，再乘请求优先级档位的倍率。
            </li>
            <li>
              <span className="text-zinc-300">选档顺序</span>：先在命中时段里找上下文区间符合的价格档，找不到再回落到 all 兜底档。区间为 [起, 止)，止留空表示无上限。
            </li>
            <li>
              <span className="text-zinc-300">扣减方式</span>：请求转发前按估算用量预检余额，不足返回 402；响应返回后按上游实际回报的用量扣减并写积分流水。
            </li>
            <li>
              <span className="text-zinc-300">口径说明</span>：缓存命中与缓存创建的 token 不重复计入输入。上游未上报缓存明细时按 0 计，费用会略高于实际。
            </li>
            <li>
              <span className="text-zinc-300">灰度开关</span>：环境变量 BILLING_ENABLED 为 true 时才启用计费与扣减，关闭时仅记录 token 用量。
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}
