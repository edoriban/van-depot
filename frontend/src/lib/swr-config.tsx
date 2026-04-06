'use client';

import { SWRConfig } from 'swr';
import { useAuthStore } from '@/stores/auth-store';

// SWR fetcher that uses the auth token
async function fetcher(url: string) {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';
  const token = useAuthStore.getState().token;

  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${url}`, { headers });

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
