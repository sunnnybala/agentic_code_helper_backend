import express from 'express';
import { z } from 'zod';
import prisma from '../lib/prismaClient.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signToken, cookieOptions, verifyToken } from '../utils/jwt.js';
import { OAuth2Client } from 'google-auth-library';

const router = express.Router();

const registerSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_\.\-]+$/),
  password: z.string().min(8),
  email: z.string().email().optional()
});

router.post('/register', async (req, res, next) => {
  try {
    console.log('[AUTH] Registration attempt:', { username: req.body.username, hasEmail: !!req.body.email, hasPassword: !!req.body.password });
    const { username, password, email } = registerSchema.parse(req.body);
    console.log('[AUTH] Registration validation passed for:', username);

    const whereConditions = [{ username: username.toLowerCase() }];
    if (email) {
      whereConditions.push({ email: email.toLowerCase() });
    }

    const existing = await prisma.user.findFirst({
      where: { OR: whereConditions }
    });
    if (existing) {
      return res.status(409).json({ success: false, error: 'Username or email already exists' });
    }

    console.log('[AUTH] Hashing password for:', username);
    const passwordHash = await hashPassword(password);
    console.log('[AUTH] Password hashed for:', username);
    const user = await prisma.user.create({
      data: {
        username: username.toLowerCase(),
        email: email ? email.toLowerCase() : null,
        passwordHash
      },
      select: { id: true, username: true, email: true, credits: true, name: true }
    });

    const token = signToken({ uid: user.id });
    res.cookie('auth_token', token, cookieOptions());
    console.log('[AUTH] Registration successful for:', username, { userId: user.id });
    return res.json({ success: true, user });
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error('[AUTH] Registration validation failed:', err.issues);
      return res.status(400).json({ success: false, error: 'Invalid input', details: err.issues });
    }
    console.error('[AUTH] Registration error:', err.message);
    next(err);
  }
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string()
});

router.post('/login', async (req, res, next) => {
  try {
    console.log('[AUTH] Login attempt', { username: req.body.username });
    const { username, password } = loginSchema.parse(req.body);
    console.log('[AUTH] Parsed login payload for', username);
    const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    console.log('[AUTH] User lookup complete for:', username, { found: !!user });
    if (!user || !user.passwordHash) {
      console.log('[AUTH] Login failed: user not found or missing passwordHash for:', username);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    const ok = await verifyPassword(password, user.passwordHash);
    console.log('[AUTH] Password verification result for', username, ok);
    if (!ok) {
      console.log('[AUTH] Login failed: incorrect password for:', username);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const publicUser = { id: user.id, username: user.username, email: user.email, credits: user.credits, name: user.name };
    const token = signToken({ uid: user.id });
    res.cookie('auth_token', token, cookieOptions());
    console.log('[AUTH] Login successful for:', username, { userId: user.id });
    return res.json({ success: true, user: publicUser });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Invalid input' });
    }
    next(err);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('auth_token', { path: '/' });
  return res.json({ success: true });
});

router.get('/me', async (req, res, next) => {
  try {
    const token = req.cookies?.auth_token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
    if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
    let payload;
    try {
      payload = verifyToken(token);
    } catch (e) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const user = await prisma.user.findUnique({
      where: { id: payload.uid },
      select: { id: true, username: true, email: true, credits: true, name: true }
    });
    if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    return res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
});

// Google sign-in endpoint: expects { idToken }
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const googleSchema = z.object({ idToken: z.string().min(10) });

router.post('/google', async (req, res, next) => {
  try {
    const { idToken } = googleSchema.parse(req.body);
    const ticket = await googleClient.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload) return res.status(400).json({ success: false, error: 'Invalid Google token' });
    const googleId = payload.sub;
    const email = payload.email?.toLowerCase() || null;
    const name = payload.name || null;

    const googleWhereConditions = [{ googleId }];
    if (email) {
      googleWhereConditions.push({ email });
    }

    let user = await prisma.user.findFirst({
      where: { OR: googleWhereConditions }
    });
    if (!user) {
      // generate a unique username from email or name
      const base = (email?.split('@')[0] || name || `user${Date.now()}`).replace(/[^a-zA-Z0-9_\.\-]/g, '').toLowerCase().slice(0, 24);
      let candidate = base || `user${Date.now()}`;
      let suffix = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const exists = await prisma.user.findUnique({ where: { username: candidate } });
        if (!exists) break;
        suffix += 1;
        candidate = `${base}${suffix}`.slice(0, 30);
      }
      user = await prisma.user.create({ data: { username: candidate, email, name, googleId } });
    } else if (!user.googleId) {
      // link googleId to existing user if matched by email
      user = await prisma.user.update({ where: { id: user.id }, data: { googleId } });
    }

    const publicUser = { id: user.id, username: user.username, email: user.email, credits: user.credits, name: user.name };
    const token = signToken({ uid: user.id });
    res.cookie('auth_token', token, cookieOptions());
    return res.json({ success: true, user: publicUser });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Invalid input' });
    }
    next(err);
  }
});

export default router;


