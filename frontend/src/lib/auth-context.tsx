'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api';
import type { TokenResponse, User, UserRole } from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('vandepot_token');
    const savedUser = localStorage.getItem('vandepot_user');
    if (saved && savedUser) {
      setToken(saved);
      setUser(JSON.parse(savedUser));
      api.setToken(saved);
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<TokenResponse>('/auth/login', { email, password });
    api.setToken(res.access_token);
    setToken(res.access_token);
    localStorage.setItem('vandepot_token', res.access_token);
    localStorage.setItem('vandepot_refresh', res.refresh_token);

    // Decode JWT to get user info (sub, email, role)
    const payload = JSON.parse(atob(res.access_token.split('.')[1]));
    const loggedUser: User = {
      id: payload.sub,
      email: payload.email,
      name: payload.email.split('@')[0],
      role: payload.role.toLowerCase() as UserRole,
      is_active: true,
      created_at: '',
      updated_at: '',
    };
    setUser(loggedUser);
    localStorage.setItem('vandepot_user', JSON.stringify(loggedUser));
  }, []);

  const logout = useCallback(() => {
    api.setToken(null);
    setToken(null);
    setUser(null);
    localStorage.removeItem('vandepot_token');
    localStorage.removeItem('vandepot_refresh');
    localStorage.removeItem('vandepot_user');
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
