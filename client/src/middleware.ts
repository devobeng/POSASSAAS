import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const AUTH_ROUTES = ['/login', '/register'];
const PROTECTED_PREFIXES = [
  '/dashboard', '/pos', '/products', '/inventory', '/orders',
  '/reports', '/branches', '/users', '/settings', '/admin',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // pos-auth is a non-httpOnly flag cookie set on login and cleared on logout.
  // The access token lives only in memory (Zustand); this cookie just tells
  // the Edge middleware whether a session exists so it can redirect.
  const isAuth = request.cookies.has('pos-auth');

  const isAuthRoute = AUTH_ROUTES.includes(pathname);
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  if (isProtected && !isAuth) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (isAuthRoute && isAuth) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon\\.ico).*)'],
};
