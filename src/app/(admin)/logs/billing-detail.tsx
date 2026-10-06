"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { BREAKDOWN_LABELS, type PriceSnapshot } from "@/lib/billing/pricing";
import { formatCreditAmount, formatMoney, formatNumber } from "@/components/ui";

export interface BillingDetailProps {
  model: string;
  providerName: string | null;
  currency: string | null;
  costOriginal: string;
  creditsCharged: string;
  period: string | null;
  priorityTier: string | null;
  multiplier: string | null;
  /** 结算时写入的单价快照；有费用就一定有它（与日志回写在同一个 batch 里原子写入） */
  snapshot: PriceSnapshot | null;
  balanceAfter: string | null;
}

/**
 * 计费明细弹窗。
 *
 * 用原生 <dialog> 保持与 FormDialog 一致的交互（Esc 关闭、点遮罩关闭），
 * 但这里只是只读展示、没有表单提交，所以不复用带 useActionState 的 FormDialog。
 */
export function BillingDetail(props: BillingDetailProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-violet-300 underline decoration-dotted underline-offset-2 hover:text-violet-200">
        明细
      </button>
      <dialog
        ref={dialogRef}
        // 必须用 showModal()：直接写 open 属性不会进入 top-layer，弹窗会被当成普通元素内联撑在表格里
        className="glass-strong m-auto w-[calc(100%-2rem)] max-w-lg p-0 text-zinc-100"
        onClick={(e) => {
          if (e.target === e.currentTarget) dialogRef.current?.close();
        }}
        onClose={() => setOpen(false)}
      >
        {/* key 保证每次打开都是全新的弹窗状态，与 FormDialog 的做法一致 */}
        {open ? <DetailBody key={`${props.model}-${props.costOriginal}`} {...props} onClose={() => dialogRef.current?.close()} /> : null}
      </dialog>
    </>
  );
}

function DetailBody(props: BillingDetailProps & { onClose: () => void }) {
  const { onClose, snapshot: snap } = props;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 挂在 dialog 内部，向上找到它并打开模态层
    ref.current?.closest("dialog")?.showModal();
  }, []);

  const multiplier = snap ? snap.multiplier : props.multiplier ? Number(props.multiplier) : 1;
  const money = (v: string | null | undefined, code?: string | null) => formatMoney(v, code ?? props.currency);

  return (
    <div ref={ref}>
      <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold">计费明细</h2>
          <p className="mt-0.5 font-mono text-xs text-zinc-400">
            {props.model}
            {props.providerName ? <span className="text-zinc-600"> · {props.providerName}</span> : null}
          </p>
        </div>
        <button type="button" onClick={onClose} className="btn-icon -mr-2" aria-label="关闭">
          <X className="size-4" />
        </button>
      </div>

      <div className="max-h-[65vh] space-y-4 overflow-y-auto px-6 py-5">
        {snap?.overflowed ? (
          <p className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            用量超出所有已配置的价格档，本次按该时段最贵的档兜底计费。请到模型上补充档位区间。
          </p>
        ) : null}

        {!snap ? (
          <p className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-xs leading-relaxed text-zinc-500">
            这条请求没有计费记录，因此没有单价明细。
            <br />
            常见原因：计费开关未开启、模型未配价格档，或主货币缺少积分汇率。
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-zinc-400">
                    <th className="px-3 py-2 text-left font-medium">计费维度</th>
                    <th className="px-3 py-2 text-right font-medium">Token</th>
                    <th className="px-3 py-2 text-right font-medium">单价 /M</th>
                    <th className="px-3 py-2 text-right font-medium">小计</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.breakdown.map((b) => (
                    <tr key={b.kind} className={`border-b border-white/5 last:border-0 ${b.tokens ? "" : "text-zinc-600"}`}>
                      <td className="px-3 py-2">{BREAKDOWN_LABELS[b.kind] ?? b.kind}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(b.tokens)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{b.unitPrice}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{money(b.amount, snap.currency ?? props.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-white/10 text-zinc-300">
                    <td className="px-3 py-2" colSpan={3}>
                      合计
                      {multiplier !== 1 ? <span className="ml-1 text-amber-300">× {multiplier} 倍</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{money(props.costOriginal, snap.currency ?? props.currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <dl className="space-y-2 text-xs">
              <Line label="计费时段">{snap.period}</Line>
              <Line label="请求优先级档位">{snap.priorityTier ?? "未声明（按 1 倍）"}</Line>

              {/* 折算链路：token 计价模型才有，用来核对当时用的汇率 */}
              {snap.currency ? (
                <>
                  <Line label="原币费用">
                    {money(props.costOriginal, snap.currency)}
                    <span className="ml-1.5 text-zinc-500">汇率 ×{snap.rateToBase ?? "—"}</span>
                  </Line>
                  <Line label="折主货币">{snap.amountBase ? money(snap.amountBase, snap.baseCurrency) : "—"}</Line>
                  <Line label="积分汇率">
                    {snap.creditRate ? (
                      <span>
                        1 {snap.baseCurrency ?? "主货币"} = {snap.creditRate} 积分
                      </span>
                    ) : (
                      "—"
                    )}
                  </Line>
                </>
              ) : null}

              <Line label="扣除积分">
                <span className="text-violet-200">{formatCreditAmount(props.creditsCharged)}</span>
                {props.balanceAfter !== null ? <span className="ml-1.5 text-zinc-500">扣后余额 {formatCreditAmount(props.balanceAfter)}</span> : null}
              </Line>
            </dl>
          </>
        )}
      </div>

      <div className="flex justify-end border-t border-white/10 px-6 py-4">
        <button type="button" className="btn-ghost" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/5 pb-2 last:border-0">
      <dt className="shrink-0 text-zinc-500">{label}</dt>
      <dd className="text-right text-zinc-300">{children}</dd>
    </div>
  );
}
