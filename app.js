import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRoutes from './routes/api.js';
import authRoutes from './routes/auth.js';
import paymentsRoutes from './routes/payments.js';
import webhooksRoutes from './routes/webhooks.js';
import { startLowCreditNotifier } from './jobs/lowCreditNotifier.js';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import prisma from './lib/prismaClient.js';
import { logger } from './utils/logger.js';

// Load environment variables
dotenv.config();

// Validate required environment variables in production and warn in other envs.
(() => {
  const requiredInProd = ['JWT_SECRET', 'DATABASE_URL', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'];
  const missing = requiredInProd.filter((k) => !process.env[k]);
  if (process.env.NODE_ENV === 'production' && missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    console.error('Aborting startup to avoid running with insecure/missing configuration.');
    process.exit(1);
  } else if (missing.length > 0) {
    console.warn('Warning: missing recommended environment variables:', missing.join(', '));
  }

  // SMTP: only treat SMTP as "provided" if SMTP_HOST is set. This avoids
  // accidental detection when unrelated envs (like SMTP_PORT) are present.
  const smtpVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const smtpProvided = !!process.env.SMTP_HOST;
  if (smtpProvided) {
    const missingSmtp = smtpVars.filter((k) => !process.env[k]);
    if (process.env.NODE_ENV === 'production' && missingSmtp.length > 0) {
      console.error('Incomplete SMTP configuration; missing:', missingSmtp.join(', '));
      process.exit(1);
    } else if (missingSmtp.length > 0) {
      console.warn('Warning: incomplete SMTP configuration; missing:', missingSmtp.join(', '));
    }
  }
})();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize express app
const app = express();

// When running behind a reverse proxy (Render, etc.), trust the first proxy
// so Express can correctly determine protocol and client IP when setting
// secure cookies and reading X-Forwarded-* headers.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
const PORT = process.env.PORT || 5001;

// Configure CORS with environment-configurable origin list. In production
// prefer a single FRONTEND_URL value supplied via environment variables to
// avoid hard-coding multiple origins. Keep localhost entries for local dev.
const corsOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  process.env.FRONTEND_URL
].filter(Boolean);

const corsOptions = {
  origin: corsOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Content-Disposition'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Middleware
app.use(logger.requestLogger);
app.use(cors(corsOptions));
app.use(helmet({
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
}));
app.use(cookieParser());
const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
app.use(limiter);
// Mount webhook route with raw body parser directly at the exact path so the
// router receives the raw Buffer for signature verification. It must be
// registered before the JSON/urlencoded body parsers so the raw Buffer is
// available for HMAC verification.
app.use('/payments/razorpay-webhook', express.raw({ type: 'application/json' }), webhooksRoutes);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API Routes
app.use('/auth', authRoutes);
app.use('/payments', paymentsRoutes);
app.use('/api', apiRoutes);

// Optionally serve static frontend build from the backend. When the frontend
// is deployed separately (e.g. Vercel), set SERVE_FRONTEND=false (default).
if (process.env.SERVE_FRONTEND === 'true') {
  app.use(express.static(join(__dirname, '../frontend/build')));

  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '../frontend/build/index.html'));
  });
}

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path
  });
});

// Global error handler
app.use(logger.errorLogger);
app.use((err, req, res, next) => {
  const requestId = req.requestId || 'unknown';

  logger.error('Global error handler triggered', {
    requestId,
    error: err.message,
    name: err.name,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method,
    statusCode: err.statusCode || 500
  });

  // Handle different types of errors
  const statusCode = err.statusCode || 500;
  const response = {
    success: false,
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  };

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    response.error = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    response.error = 'Token expired';
  }

  res.status(statusCode).json(response);
});

// Start server unless running tests
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    try { startLowCreditNotifier(); } catch (_) {}
  });
}

export default app;
