"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, createSessionToken, SESSION_COOKIE } from "../session";
import type { ActionState } from "../types";

export async function login(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const password = String(fd.get("password") ?? "");
  if (!process.env.ADMIN_PASSWORD) return { error: "服务器未配置 ADMIN_PASSWORD" };
  if (!checkPassword(password)) return { error: "密码错误" };

  const { token, expires } = await createSessionToken();
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });

  const next = String(fd.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
