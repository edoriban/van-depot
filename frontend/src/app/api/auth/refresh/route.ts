import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get('vanflux_refresh')?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
  }

  const backendRes = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  }).catch(() => null);

  if (!backendRes || !backendRes.ok) {
    // Refresh failed — clear both cookies
    const response = NextResponse.json({ error: 'Refresh failed' }, { status: 401 });
    response.cookies.set('vanflux_access', '', { maxAge: 0, path: '/' });
    response.cookies.set('vanflux_refresh', '', { maxAge: 0, path: '/api/auth/refresh' });
    return response;
  }

  const data: { access_token: string; refresh_token?: string } = await backendRes.json();

  const isProduction = process.env.NODE_ENV === 'production';

  const response = NextResponse.json({ ok: true });

  response.cookies.set('vanflux_access', data.access_token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
    path: '/',
    maxAge: 900,
  });

  // If backend also rotates the refresh token, update it
  if (data.refresh_token) {
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
