import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const AUTH_ROUTES = ['/login', '/register'];
const PROTECTED_PREFIXES = [
  '/dashboard', '/pos', '/products', '/inventory', '/orders',
  '/reports', '/branches', '/users', '/settings', '/admin',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // pos-auth is a non-httpOnly cookie set on login (value = the user's role)
  // and cleared on logout. The access token lives only in memory (Zustand);
  // this cookie is the only session/role signal the Edge middleware has.
  const authRole = request.cookies.get('pos-auth')?.value;
  const isAuth = !!authRole;

  const isAuthRoute = AUTH_ROUTES.includes(pathname);
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  if (isProtected && !isAuth) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (isAuthRoute && isAuth) {
    const url = request.nextUrl.clone();
    // SUPER_ADMIN has no storeId, so the per-store /dashboard 400s on every
    // KPI/report call for them — send them straight to the page that works.
    url.pathname = authRole === 'SUPER_ADMIN' ? '/admin' : '/dashboard';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon\\.ico).*)'],
};
