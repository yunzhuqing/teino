"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BookOpen, Coins, KeyRound, LayoutDashboard, LogOut, Server, Sparkles, Tags, Users } from "lucide-react";
import { logout } from "@/lib/actions/auth";

const NAV = [
  { href: "/", label: "概览", icon: LayoutDashboard },
  { href: "/providers", label: "供应商与模型", icon: Server },
  { href: "/users", label: "用户", icon: Users },
  { href: "/keys", label: "API Keys", icon: KeyRound },
  { href: "/billing", label: "计费", icon: Coins },
  { href: "/tags", label: "标签", icon: Tags },
  { href: "/logs", label: "请求日志", icon: Activity },
  { href: "/docs", label: "接入文档", icon: BookOpen },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="glass sticky top-4 flex h-[calc(100vh-2rem)] w-60 shrink-0 flex-col p-4 max-md:hidden">
      <Link href="/" className="mb-8 flex items-center gap-2.5 px-2 pt-1">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-sky-500 shadow-lg shadow-violet-900/50">
          <Sparkles className="size-4.5 text-white" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">Teino</div>
          <div className="text-[11px] text-zinc-500">AI Gateway</div>
        </div>
      </Link>
      <nav className="flex flex-1 flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                active
                  ? "bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              <Icon className={`size-4 ${active ? "text-violet-300" : ""}`} />
              {label}
            </Link>
          );
        })}
      </nav>
      <form action={logout}>
        <button type="submit" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100">
          <LogOut className="size-4" />
          退出登录
        </button>
      </form>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="glass mb-4 flex gap-1 overflow-x-auto p-2 md:hidden">
      {NAV.map(({ href, label }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link key={href} href={href} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${active ? "bg-white/10 text-white" : "text-zinc-400"}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
