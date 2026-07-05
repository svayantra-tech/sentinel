// POST /api/auth/login — issues an 8h JWT (FR-13). Demo directory only;
// production swaps in SSO/OIDC (docs/SECURITY.md §2).
import { NextRequest, NextResponse } from 'next/server';
import { DEMO_USERS, issueToken, parseBody, rateLimit, LoginBody } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const body = await parseBody(req, LoginBody);
  if ('error' in body) return body.error;

  const user = DEMO_USERS.find((u) => u.sub === body.data.userId);
  if (!user || user.password() !== body.data.password) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
  const token = await issueToken(user);
  const res = NextResponse.json({
    token,
    user: { sub: user.sub, name: user.name, role: user.role, authLevel: user.authLevel },
  });
  res.cookies.set('sentinel_token', token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 3600,
  });
  return res;
}

export async function GET() {
  // Expose the demo directory (names only) so the login screen can render it.
  return NextResponse.json({
    users: DEMO_USERS.map((u) => ({ sub: u.sub, name: u.name, authLevel: u.authLevel })),
    hint: 'password: sentinel-demo (or DEMO_PASSWORD env)',
  });
}
