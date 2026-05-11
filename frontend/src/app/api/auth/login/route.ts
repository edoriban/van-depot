/**
 * `/api/auth/login` — proxy to backend `/auth/login` for the multi-tenant
 * two-step login flow (`sdd/multi-tenant-foundation/design` §6).
 *
 * The backend returns one of two shapes (untagged enum):
 *   - **Final** `{ access_token, refresh_token, user, tenant, role, is_superadmin }`
 *   - **MultiTenant** `{ intermediate_token, memberships }`
 *
 * This handler forwards the response shape verbatim so the client store
 * (`useAuthStore.login`) can dispatch on `'access_token' in response`. Cookies
 * (HttpOnly access + refresh) are set ONLY for the `Final` branch — the
 * intermediate token is in-memory only on the client (it has a 60s TTL on the
 * backend and is single-use against `/auth/select-tenant`).
 */
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
  }

  const backendRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: body.email, password: body.password }),
    cache: 'no-store',
  }).catch(() => null);

  if (!backendRes) {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }

  if (!backendRes.ok) {
    const error = await backendRes.json().catch(() => ({ error: 'Login failed' }));
    return NextResponse.json(error, { status: backendRes.status });
  }

  const data = await backendRes.json();
  const response = NextResponse.json(data);

  // Final response — set cookies. MultiTenant — no cookies until select.
  if (typeof data.access_token === 'string') {
    setAuthCookies(response, data.access_token, data.refresh_token);
  }

  return response;
}

function setAuthCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string,
): void {
  const isProduction = process.env.NODE_ENV === 'production';
  response.cookies.set('vanflux_access', accessToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
    path: '/',
    maxAge: 86400,
  });
  response.cookies.set('vanflux_refresh', refreshToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
    path: '/api/auth/refresh',
    maxAge: 604800,
  });
}
