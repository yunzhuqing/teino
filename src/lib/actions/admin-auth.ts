"use server";

import { checkPassword, getAdminLoginPath } from "../session";
import type { ActionState } from "../types";
import { startSession } from "../session-cookie";

/** 管理员登录。只由 ADMIN_LOGIN_PATH 对应的页面引用；未配置入口时一律拒绝 */
export async function adminLogin(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!getAdminLoginPath() || !process.env.ADMIN_PASSWORD) return { error: "密码错误" };
  if (!checkPassword(String(fd.get("password") ?? ""))) return { error: "密码错误" };
  return startSession({ role: "admin" }, "/");
}
