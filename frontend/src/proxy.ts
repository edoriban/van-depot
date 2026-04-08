import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/registro', '/recuperar', '/activar'];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next') ||
    pathname.includes('.');

  if (isPublic) return NextResponse.next();

  const token = req.cookies.get('vanflux_access')?.value;
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Optimistic expiry check — no crypto, just base64url decode
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64));
    if (payload.exp && payload.exp < Date.now() / 1000) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
  } catch {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.svg$|.*\\.png$).*)'],
};
