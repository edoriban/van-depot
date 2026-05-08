/**
 * `/api/auth/select-tenant` — proxy to backend `/auth/select-tenant` (A13).
 *
 * Body:  `{ tenant_id, intermediate_token }` — the client posts the
 *        intermediate token explicitly because it lives in the in-memory
 *        Zustand store (NEVER persisted, NEVER in a cookie).
 * Returns: `LoginResponse.Final` JSON. On success, sets HttpOnly access +
 *          refresh cookies (same shape as `/api/auth/login` Final branch).
 */
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.tenant_id || !body?.intermediate_token) {
    return NextResponse.json(
      { error: 'tenant_id and intermediate_token required' },
      { status: 400 },
    );
  }

  const backendRes = await fetch(`${API_URL}/auth/select-tenant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${body.intermediate_token}`,
    },
    body: JSON.stringify({ tenant_id: body.tenant_id }),
  }).catch(() => null);

  if (!backendRes) {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }

  if (!backendRes.ok) {
    const error = await backendRes.json().catch(() => ({ error: 'Tenant selection failed' }));
    return NextResponse.json(error, { status: backendRes.status });
  }

  const data = await backendRes.json();
  const response = NextResponse.json(data);

  if (typeof data.access_token === 'string') {
    const isProduction = process.env.NODE_ENV === 'production';
    response.cookies.set('vanflux_access', data.access_token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: isProduction,
      path: '/',
      maxAge: 86400,
    });
    response.cookies.set('vanflux_refresh', data.refresh_token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: isProduction,
      path: '/api/auth/refresh',
      maxAge: 604800,
    });
  }

  return response;
}
