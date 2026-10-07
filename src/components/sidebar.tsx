"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BookOpen, Boxes, Coins, KeyRound, LayoutDashboard, LogOut, Server, Sparkles, Tags, Users } from "lucide-react";
import { logout } from "@/lib/actions/auth";

const NAVS = {
  admin: {
    home: "/",
    subtitle: "AI Gateway",
    items: [
      { href: "/", label: "概览", icon: LayoutDashboard },
      { href: "/providers", label: "供应商与模型", icon: Server },
      { href: "/users", label: "用户", icon: Users },
      { href: "/keys", label: "API Keys", icon: KeyRound },
      { href: "/billing", label: "计费", icon: Coins },
      { href: "/tags", label: "标签", icon: Tags },
      { href: "/logs", label: "请求日志", icon: Activity },
      { href: "/docs", label: "接入文档", icon: BookOpen },
    ],
  },
  console: {
    home: "/console",
    subtitle: "开发者控制台",
    items: [
      { href: "/console", label: "用量", icon: LayoutDashboard },
      { href: "/console/keys", label: "API Keys", icon: KeyRound },
      { href: "/console/models", label: "模型", icon: Boxes },
      { href: "/console/logs", label: "请求明细", icon: Activity },
      { href: "/console/docs", label: "接入文档", icon: BookOpen },
    ],
  },
};

export type NavVariant = keyof typeof NAVS;

function isActive(href: string, home: string, pathname: string) {
  return href === home ? pathname === home : pathname.startsWith(href);
}

export function Sidebar({ variant = "admin", account }: { variant?: NavVariant; account?: string }) {
  const pathname = usePathname();
  const nav = NAVS[variant];
  return (
    <aside className="glass sticky top-4 flex h-[calc(100vh-2rem)] w-60 shrink-0 flex-col p-4 max-md:hidden">
      <Link href={nav.home} className="mb-8 flex items-center gap-2.5 px-2 pt-1">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-sky-500 shadow-lg shadow-violet-500/30">
          <Sparkles className="size-4.5 text-white" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">Teino</div>
          <div className="text-[11px] text-zinc-500">{nav.subtitle}</div>
        </div>
      </Link>
      <nav className="flex flex-1 flex-col gap-1">
        {nav.items.map(({ href, label, icon: Icon }) => {
          const active = isActive(href, nav.home, pathname);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                active
                  ? "bg-white/90 text-zinc-900 ring-1 ring-zinc-900/10 shadow-[0_4px_14px_-6px_rgba(15,23,42,0.25)]"
                  : "text-zinc-600 hover:bg-white/70 hover:text-zinc-900"
              }`}
            >
              <Icon className={`size-4 ${active ? "text-violet-600" : ""}`} />
              {label}
            </Link>
          );
        })}
      </nav>
      {account ? <div className="mb-1 truncate px-3 text-xs text-zinc-500" title={account}>{account}</div> : null}
      <form action={logout}>
        <button type="submit" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-zinc-600 transition hover:bg-white/70 hover:text-zinc-900">
          <LogOut className="size-4" />
          退出登录
        </button>
      </form>
    </aside>
  );
}

export function MobileNav({ variant = "admin" }: { variant?: NavVariant }) {
  const pathname = usePathname();
  const nav = NAVS[variant];
  return (
    <nav className="glass mb-4 flex gap-1 overflow-x-auto p-2 md:hidden">
      {nav.items.map(({ href, label }) => {
        const active = isActive(href, nav.home, pathname);
        return (
          <Link key={href} href={href} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${active ? "bg-white/90 text-zinc-900 ring-1 ring-zinc-900/10" : "text-zinc-500"}`}>
            {label}
          </Link>
        );
      })}
      <form action={logout} className="ml-auto shrink-0">
        <button type="submit" className="rounded-lg px-3 py-1.5 text-xs text-zinc-500">
          退出
        </button>
      </form>
    </nav>
  );
}
