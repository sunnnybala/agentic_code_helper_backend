import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'development_secret_change_me';
const TOKEN_TTL = '7d';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}


export function cookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    // When the frontend and backend are hosted on different origins (e.g.
    // Vercel frontend and Render backend), cookies must be sent cross-site.
    // Browsers require SameSite=None and Secure=true for cross-site cookies.
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000
  };
}

// Sign a short-lived JWT for non-cookie flows (e.g., SSE tokens). TTL is in
// seconds. This token should be used only for ephemeral authorization and
// should carry minimal claims (like uid and a type/audience).
export function signShortLivedToken(payload, ttlSeconds = 300) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ttlSeconds });
}

// Keep a single exported verifyToken function
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}


