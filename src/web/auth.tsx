import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router';
import { api } from './api';
import { Boot } from './components/Boot';
import type { User } from '../shared/types';

interface AuthState {
  /** undefined while the session is being checked, null when signed out. */
  user: User | null | undefined;
  setUser: (user: User | null) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api
      .get<{ user: User }>('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);

  async function signOut() {
    await api.post('/auth/logout').catch(() => undefined);
    setUser(null);
  }

  return <AuthContext value={{ user, setUser, signOut }}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth harus dipakai di dalam AuthProvider');
  return value;
}

/** Shows the page only when signed in. Otherwise sends the user to the login page. */
export function RequireAuth() {
  const { user } = useAuth();
  if (user === undefined) return <Boot />;
  if (user === null) return <Navigate to="/login" replace />;
  return <Outlet />;
}
