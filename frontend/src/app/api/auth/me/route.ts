import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const token = req.cookies.get('vanflux_access')?.value;
  if (!token) {
    return NextResponse.json({ error: 'No access token' }, { status: 401 });
  }

  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));

    if (payload.exp && payload.exp < Date.now() / 1000) {
      return NextResponse.json({ error: 'Token expired' }, { status: 401 });
    }

    const user = {
      id: payload.sub,
      email: payload.email,
      name: payload.email.split('@')[0],
      role: (payload.role as string).toLowerCase(),
    };

    return NextResponse.json({ user, token });
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }
}
