import { useAuthStore } from '@/stores/auth-store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

async function refreshAndRetry<T>(path: string, options?: RequestInit): Promise<T> {
  // Attempt token refresh
  const refreshRes = await fetch('/api/auth/refresh', { method: 'POST' });
  if (!refreshRes.ok) {
    // Refresh failed — logout and redirect
    await useAuthStore.getState().logout();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new Error('Session expired');
  }

  // Get new in-memory token from /api/auth/me
  const meRes = await fetch('/api/auth/me');
  if (meRes.ok) {
    const meData: { token: string } = await meRes.json();
    useAuthStore.getState().setAccessToken(meData.token);
  }

  // Retry original request with new token
  return request<T>(path, options, /* retry */ false);
}

async function request<T>(
  path: string,
  options?: RequestInit,
  allowRetry = true,
): Promise<T> {
  const token = useAuthStore.getState()._accessToken;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401 && allowRetry) {
    return refreshAndRetry<T>(path, options);
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) =>
    request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }),
};
