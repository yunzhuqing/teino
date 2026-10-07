import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_LOGIN_ROUTE, canAccessPath, getAdminLoginPath, homeFor, SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * 登录拦截与按角色分流；Server Action 内部仍会再次校验角色。
 * 管理员登录页只能经 ADMIN_LOGIN_PATH 进入（内部改写到 ADMIN_LOGIN_ROUTE），
 * 对其他人表现得和任何不存在的路径一样，不暴露管理端的存在。
 */
export async function proxy(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = request.nextUrl;
  const adminLoginPath = getAdminLoginPath();

  if (adminLoginPath && pathname === adminLoginPath) {
    if (session?.role === "admin") return NextResponse.redirect(new URL(homeFor(session), request.url));
    // 已登录的普通用户访问时，与其他非控制台路径一样被送回控制台
    if (!session) return NextResponse.rewrite(new URL(ADMIN_LOGIN_ROUTE, request.url));
  }

  if (!session) {
    if (pathname === "/login") return NextResponse.next();
    const url = new URL("/login", request.url);
    // 只为控制台页面保留回跳地址，避免在登录页 URL 里露出管理端路径
    if (pathname.startsWith("/console")) url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (pathname === "/login" || pathname === ADMIN_LOGIN_ROUTE || !canAccessPath(session, pathname)) {
    return NextResponse.redirect(new URL(homeFor(session), request.url));
  }
  return NextResponse.next();
}

export const config = {
  // 排除网关 API、静态资源
  matcher: ["/((?!api|v1|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
