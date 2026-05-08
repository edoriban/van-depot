'use client';

import { SWRConfig } from 'swr';
import { useAuthStore } from '@/stores/auth-store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

// SWR fetcher that uses the in-memory auth token
async function fetcher(url: string) {
  const token = useAuthStore.getState().accessToken;

  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (token) (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${url}`, { headers });

  if (res.status === 401) {
    // Attempt refresh
    const refreshRes = await fetch('/api/auth/refresh', { method: 'POST' });
    if (!refreshRes.ok) {
      useAuthStore.getState().logout();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
      throw new Error('Session expired');
    }

    // Get new in-memory token
    const meRes = await fetch('/api/auth/me');
    if (meRes.ok) {
      const meData: { token: string } = await meRes.json();
      useAuthStore.getState().setAccessToken(meData.token);
    }

    // Retry with new token
    const newToken = useAuthStore.getState().accessToken;
    const retryHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (newToken) retryHeaders['Authorization'] = `Bearer ${newToken}`;

    const retryRes = await fetch(`${API_URL}${url}`, { headers: retryHeaders });
    if (!retryRes.ok) {
      const error = await retryRes.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${retryRes.status}`);
    }
    if (retryRes.status === 204) return undefined;
    return retryRes.json();
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined;
  return res.json();
}

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{
      fetcher,
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }}>
      {children}
    </SWRConfig>
  );
}
