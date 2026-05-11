import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get('vanflux_refresh')?.value;

  // Best-effort: notify backend of logout
  if (refreshToken) {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-store',
    }).catch(() => {
      // Ignore backend errors — we always clear cookies locally
    });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set('vanflux_access', '', { maxAge: 0, path: '/' });
  response.cookies.set('vanflux_refresh', '', { maxAge: 0, path: '/api/auth/refresh' });
  return response;
}
