'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest, tokenStorage, type User } from '@/lib/api';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    if (!tokenStorage.get()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await apiRequest<User>('/api/v1/auth/me');
      setUser(me);
    } catch {
      tokenStorage.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (phone: string, password: string) => {
      const resp = await apiRequest<{
        accessToken: string;
        refreshToken: string;
        user: User;
      }>('/api/v1/auth/login', {
        method: 'POST',
        body: { phone, password },
      });
      tokenStorage.set(resp.accessToken);
      tokenStorage.setRefresh(resp.refreshToken);
      const fullUser = { ...resp.user, phone };
      setUser(fullUser);
      router.push(fullUser.mustChangePassword ? '/change-password' : '/dashboard');
    },
    [router],
  );

  const logout = useCallback(() => {
    const refreshToken = tokenStorage.getRefresh();
    tokenStorage.clear();
    setUser(null);
    // Best-effort revoke server-side; we already wiped local state so
    // failures don't matter for UX.
    if (refreshToken) {
      void apiRequest('/api/v1/auth/logout', {
        method: 'POST',
        body: { refreshToken },
      }).catch(() => undefined);
    }
    router.push('/login');
  }, [router]);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
