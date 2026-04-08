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
  }).catch(() => null);

  if (!backendRes) {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }

  if (!backendRes.ok) {
    const error = await backendRes.json().catch(() => ({ error: 'Activation failed' }));
    return NextResponse.json(error, { status: backendRes.status });
  }

  const data: { access_token: string; refresh_token: string } = await backendRes.json();

  // Decode JWT payload (base64url → base64 → JSON)
  const b64 = data.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));

  const user = {
    id: payload.sub,
    email: payload.email,
    name: payload.email.split('@')[0],
    role: (payload.role as string).toLowerCase(),
  };

  const isProduction = process.env.NODE_ENV === 'production';

  const response = NextResponse.json({ user });

  response.cookies.set('vanflux_access', data.access_token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
    path: '/',
    maxAge: 900,
  });

  response.cookies.set('vanflux_refresh', data.refresh_token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
    path: '/api/auth/refresh',
    maxAge: 604800,
  });

  return response;
}
