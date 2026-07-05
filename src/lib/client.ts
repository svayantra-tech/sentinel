'use client';
// Client-side auth + fetch helpers shared by the three dashboards.
import { useCallback, useEffect, useState } from 'react';

export interface ClientUser { sub: string; name: string; role: string; authLevel: number }

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('sentinel_token');
}

export function getUser(): ClientUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('sentinel_user');
  return raw ? (JSON.parse(raw) as ClientUser) : null;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? res.statusText);
  return res.json() as Promise<T>;
}

export function usePoll<T>(path: string | null, ms: number): { data: T | null; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    if (!path) return;
    api<T>(path).then((d) => { setData(d); setError(null); }).catch((e) => setError(String(e.message ?? e)));
  }, [path]);
  useEffect(() => {
    refresh();
    if (!path) return;
    const t = setInterval(refresh, ms);
    return () => clearInterval(t);
  }, [path, ms, refresh]);
  return { data, error, refresh };
}

export function useSession(): { user: ClientUser | null; ready: boolean; logout: () => void } {
  const [user, setUser] = useState<ClientUser | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { setUser(getUser()); setReady(true); }, []);
  const logout = useCallback(() => {
    localStorage.removeItem('sentinel_token');
    localStorage.removeItem('sentinel_user');
    setUser(null);
  }, []);
  return { user, ready, logout };
}
