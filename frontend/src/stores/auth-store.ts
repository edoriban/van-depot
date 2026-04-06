import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, TokenResponse } from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isHydrated: boolean;

  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  setHydrated: () => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      refreshToken: null,
      isHydrated: false,

      login: async (email: string, password: string) => {
        const res = await fetch(`${API_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });

        if (!res.ok) {
          const error = await res.json().catch(() => ({ error: 'Login failed' }));
          throw new Error(error.error || 'Invalid credentials');
        }

        const data: TokenResponse = await res.json();

        // Decode JWT to get user info
        const payload = JSON.parse(atob(data.access_token.split('.')[1]));
        const user: User = {
          id: payload.sub,
          email: payload.email,
          name: payload.email.split('@')[0],
          role: payload.role.toLowerCase() as User['role'],
          is_active: true,
          created_at: '',
          updated_at: '',
        };

        set({ user, token: data.access_token, refreshToken: data.refresh_token });
      },

      logout: () => {
        set({ user: null, token: null, refreshToken: null });
      },

      setHydrated: () => set({ isHydrated: true }),
    }),
    {
      name: 'vandepot-auth',
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    }
  )
);
