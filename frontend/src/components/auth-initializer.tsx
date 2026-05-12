'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import type { User } from '@/types';

export function AuthInitializer() {
  const setUser = useAuthStore((s) => s.setUser);
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  const setHydrated = useAuthStore((s) => s.setHydrated);

  useEffect(() => {
    // react-doctor: init-time fetch, not a real anti-pattern
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { user: User; token: string } | null) => {
        if (data?.user) {
          setUser(data.user);
          setAccessToken(data.token);
        }
      })
      .catch(() => {})
      .finally(() => setHydrated());
  }, [setUser, setAccessToken, setHydrated]);

  return null;
}
