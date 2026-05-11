/**
 * `/api/auth/activate` — proxy to backend `/auth/activate`. Backend now returns
 * the same `LoginResponse` shape as `/auth/login` (Final OR MultiTenant), so we
 * forward verbatim. Cookies are set ONLY for the Final branch.
 */
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.code || !body?.new_password) {
    return NextResponse.json(
      { error: 'Email, code and new_password required' },
      { status: 400 },
    );
  }

  const backendRes = await fetch(`${API_URL}/auth/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: body.email,
      code: body.code,
      new_password: body.new_password,
    }),
    cache: 'no-store',
  }).catch(() => null);

  if (!backendRes) {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }

  if (!backendRes.ok) {
    const error = await backendRes.json().catch(() => ({ error: 'Activation failed' }));
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
