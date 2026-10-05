import { Suspense } from "react";
import Link from "next/link";
import { Activity, ArrowUpRight, Boxes, Gauge, KeyRound, Server, Users, Zap } from "lucide-react";
import { formatNumber, PageHeader } from "@/components/ui";
import { getDashboardStats } from "@/lib/stats";

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="概览" description="网关运行状态与最近 24 小时流量" />
      <Suspense fallback={<StatsSkeleton />}>
        <Stats />
      </Suspense>
      <QuickStart />
    </>
  );
}

async function Stats() {
  const { counts, traffic, byProvider } = await getDashboardStats();
  const successRate = traffic.total ? Math.round((traffic.success / traffic.total) * 1000) / 10 : null;
  const maxN = byProvider[0]?.n ?? 0;

  const resources = [
    { label: "供应商", value: counts.providers, icon: Server, href: "/providers" },
    { label: "模型", value: counts.models, icon: Boxes, href: "/providers" },
    { label: "用户", value: counts.users, icon: Users, href: "/users" },
    { label: "API Keys", value: counts.keys, icon: KeyRound, href: "/keys" },
  ];
  const metrics = [
    { label: "24h 请求", value: formatNumber(traffic.total), icon: Activity, tone: "text-violet-300" },
    { label: "成功率", value: successRate == null ? "—" : `${successRate}%`, icon: Zap, tone: "text-emerald-300" },
    { label: "平均延迟", value: traffic.total ? `${formatNumber(traffic.avgLatency)} ms` : "—", icon: Gauge, tone: "text-sky-300" },
    { label: "Tokens（入 / 出）", value: `${formatNumber(traffic.inputTokens ?? 0)} / ${formatNumber(traffic.outputTokens ?? 0)}`, icon: ArrowUpRight, tone: "text-pink-300" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="glass p-5">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              {label}
              <Icon className={`size-4 ${tone}`} />
            </div>
            <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="glass p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold">24h 供应商流量分布</h2>
          {byProvider.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">暂无请求</p>
          ) : (
            <div className="space-y-3">
              {byProvider.map((p) => (
                <div key={p.name}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-zinc-300">{p.name}</span>
                    <span className="tabular-nums text-zinc-500">{formatNumber(p.n)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/5">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-sky-400" style={{ width: `${(p.n / maxN) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="glass grid grid-cols-2 gap-3 p-5">
          {resources.map(({ label, value, icon: Icon, href }) => (
            <Link key={label} href={href} className="rounded-xl border border-white/5 bg-white/[0.03] p-3.5 transition hover:border-white/15 hover:bg-white/[0.06]">
              <Icon className="size-4 text-zinc-400" />
              <div className="mt-2 text-xl font-semibold tabular-nums">{value}</div>
              <div className="text-xs text-zinc-500">{label}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="glass h-[106px] animate-pulse" />
      ))}
    </div>
  );
}

const STEPS = [
  ["创建标签（可选）", "如 vip / internal，用于限定可访问的上游", "/tags"],
  ["添加供应商与模型", "配置 Base URL、API 类型，设置模型优先级与权重", "/providers"],
  ["创建用户并签发 Key", "为用户或 Key 打标签以控制路由范围", "/users"],
  ["接入", "将 SDK 的 Base URL 指向本网关", "/docs"],
] as const;

function QuickStart() {
  return (
    <section className="glass mt-5 p-5">
      <h2 className="mb-4 text-sm font-semibold">快速开始</h2>
      <ol className="grid gap-3 md:grid-cols-4">
        {STEPS.map(([title, desc, href], i) => (
          <li key={title}>
            <Link href={href} className="flex h-full gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3.5 transition hover:border-white/15">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-xs font-semibold text-violet-200">{i + 1}</span>
              <span>
                <span className="block text-sm font-medium">{title}</span>
                <span className="mt-0.5 block text-xs text-zinc-500">{desc}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
