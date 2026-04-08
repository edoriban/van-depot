import { create } from 'zustand';
import type { User } from '@/types';

interface AuthState {
  user: User | null;
  /** In-memory only — never persisted. Used for Bearer tokens in API calls. */
  _accessToken: string | null;
  isHydrated: boolean;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
  setAccessToken: (token: string | null) => void;
  setHydrated: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  _accessToken: null,
  isHydrated: false,

  login: async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(error.error || 'Invalid credentials');
    }

    const data: { user: { id: string; email: string; name: string; role: string } } =
      await res.json();

    // Fetch me to get the in-memory token right after login
    const meRes = await fetch('/api/auth/me');
    const meData = meRes.ok ? await meRes.json() : null;

    const user: User = {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name,
      role: data.user.role as User['role'],
      is_active: true,
      created_at: '',
      updated_at: '',
    };

    set({ user, _accessToken: meData?.token ?? null });
  },

  logout: async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    set({ user: null, _accessToken: null });
  },

  setUser: (user: User | null) => set({ user }),

  setAccessToken: (token: string | null) => set({ _accessToken: token }),

  setHydrated: () => set({ isHydrated: true }),
}));
