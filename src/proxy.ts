import { NextResponse, type NextRequest } from "next/server";
import { canAccessPath, homeFor, SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/** 管理后台与用户控制台的乐观鉴权；Server Action 内部仍会再次校验角色 */
export async function proxy(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/login";

  if (!session) {
    if (isLogin) return NextResponse.next();
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (isLogin || !canAccessPath(session, pathname)) return NextResponse.redirect(new URL(homeFor(session), request.url));
  return NextResponse.next();
}

export const config = {
  // 排除网关 API、静态资源
  matcher: ["/((?!api|v1|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
