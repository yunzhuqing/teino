import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { canAccessPath, createSessionToken, homeFor, SESSION_COOKIE, type Session } from "./session";

/**
 * 写入会话 Cookie 并跳转；next 不可访问时回到该角色的首页。
 * 注意：不能放进 "use server" 文件——那里的导出都会成为可被客户端直接调用的 Server Action。
 */
export async function startSession(session: Session, next: string): Promise<never> {
  const { token, expires } = await createSessionToken(session);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
  const safe = next.startsWith("/") && !next.startsWith("//") && canAccessPath(session, next);
  redirect(safe ? next : homeFor(session));
}
