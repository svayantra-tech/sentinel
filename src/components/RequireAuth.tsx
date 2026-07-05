'use client';
// Shared sign-in guard for the operational surfaces. Renders children with the
// session user, or a "sign in on Operations first" prompt.
import { useSession, type ClientUser } from '@/lib/client';

export function RequireAuth({ children }: { children: (user: ClientUser) => React.ReactNode }) {
  const { user, ready } = useSession();
  if (!ready) return null;
  if (!user) {
    return (
      <main className="mx-auto max-w-md px-4 pt-20 text-center text-muted">
        <p>Sign in on the <a href="/" className="text-teal underline">Operations</a> page first.</p>
      </main>
    );
  }
  return <>{children(user)}</>;
}
