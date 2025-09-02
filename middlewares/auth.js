import jwt from 'jsonwebtoken';
import prisma from '../lib/prismaClient.js';

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.auth_token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
    if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET || 'development_secret_change_me');
    } catch (e) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const user = await prisma.user.findUnique({ where: { id: payload.uid } });
    if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}


