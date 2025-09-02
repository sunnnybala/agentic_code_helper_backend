import request from 'supertest';
import crypto from 'crypto';
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

let app;
import prisma from '../lib/prismaClient.js';
jest.mock('../lib/prismaClient.js');

const PREV_ENV = {};

beforeEach(async () => {
  // Reset module registry so our mocked middleware/prisma are applied when
  // we dynamically import the app.
  jest.resetModules();

  // No auth middleware mocking here; we'll send a real JWT cookie so the
  // actual middleware path is exercised. Ensure prisma.user.findUnique is
  // mocked to return the corresponding user id.

  PREV_ENV.SITE_ID = process.env.SITE_ID;
  PREV_ENV.RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
  PREV_ENV.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
  process.env.SITE_ID = 'ai_ot_helper';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'hook_secret_test';
  process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';

  jest.resetAllMocks();

  // base mocked methods
  prisma.payment = { findUnique: jest.fn(), update: jest.fn() };
  prisma.webhookEvent = { create: jest.fn(), update: jest.fn() };
  prisma.creditLedger = { findFirst: jest.fn(), create: jest.fn() };
  prisma.user = { update: jest.fn(), findUnique: jest.fn() };

  // Mock $transaction to provide tx object using our mocked methods
  prisma.$TransactionMock = async (cb) => {
    const tx = { payment: prisma.payment, webhookEvent: prisma.webhookEvent, creditLedger: prisma.creditLedger, user: prisma.user };
    return cb(tx);
  };
  prisma.$transaction = jest.fn(async (cb) => prisma.$TransactionMock(cb));

  // Import app after mocks are configured so the routes pick up the mocked
  // auth and prisma instances.
  const imported = await import('../app.js');
  app = imported.default;
});

afterEach(() => {
  process.env.SITE_ID = PREV_ENV.SITE_ID;
  process.env.RAZORPAY_WEBHOOK_SECRET = PREV_ENV.RAZORPAY_WEBHOOK_SECRET;
  jest.resetAllMocks();
});

function makeSignature(body) {
  return crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
}

test('webhook is idempotent for duplicate deliveries', async () => {
  const payload = {
    id: 'evt_dup',
    event: 'payment.captured',
    payload: {
      payment: { entity: { id: 'pay_dup', amount: 2000, order_id: 'order_dup', notes: { website_id: 'ai_ot_helper' } } },
      order: { entity: { id: 'order_dup', amount: 2000 } }
    }
  };
  const raw = JSON.stringify(payload);

  // first create succeeds, second create fails with unique constraint
  prisma.webhookEvent.create = jest.fn().mockResolvedValueOnce({}).mockRejectedValueOnce({ code: 'P2002' });
  prisma.payment.findUnique.mockResolvedValue({ id: 10, amountPaise: 2000, creditsPurchased: 4, userId: 20 });
  prisma.creditLedger.findFirst.mockResolvedValue(null);
  prisma.creditLedger.create = jest.fn().mockResolvedValue({});
  prisma.payment.update = jest.fn().mockResolvedValue({});
  prisma.user.update = jest.fn().mockResolvedValue({ credits: 100 });

  const sig = makeSignature(raw);

  const res1 = await request(app).post('/payments/razorpay-webhook').set('x-razorpay-signature', sig).set('Content-Type', 'application/json').send(raw);
  const res2 = await request(app).post('/payments/razorpay-webhook').set('x-razorpay-signature', sig).set('Content-Type', 'application/json').send(raw);

  expect(res1.statusCode).toBe(200);
  expect(res2.statusCode).toBe(200);
  expect(prisma.creditLedger.create).toHaveBeenCalledTimes(1);
});

test('verify + webhook results in a single credit ledger', async () => {
  const razorpay_order_id = 'order_c';
  const razorpay_payment_id = 'pay_c';
  const verifySig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
  const verifyBody = { razorpay_order_id, razorpay_payment_id, razorpay_signature: verifySig };
  const webhookPayload = {
    id: 'evt_c',
    event: 'payment.captured',
    payload: {
      payment: { entity: { id: 'pay_c', amount: 3000, order_id: 'order_c', notes: { website_id: 'ai_ot_helper' } } },
      order: { entity: { id: 'order_c', amount: 3000 } }
    }
  };
  const raw = JSON.stringify(webhookPayload);

  // Setup mocks
  prisma.payment.findUnique.mockResolvedValue({ id: 11, amountPaise: 3000, creditsPurchased: 6, userId: 21 });
  prisma.webhookEvent.create.mockResolvedValue({});
  prisma.creditLedger.findFirst.mockResolvedValue(null);
  prisma.creditLedger.create = jest.fn().mockResolvedValue({});
  prisma.payment.update = jest.fn().mockResolvedValue({});
  prisma.user.update = jest.fn().mockResolvedValue({ credits: 50 });
  prisma.user.findUnique.mockResolvedValue({ credits: 44 });

  const sig = makeSignature(raw);

  // Perform verify (which no longer credits) and webhook in parallel
  // create a JWT for user id 21 and set cookie so requireAuth passes
  prisma.user.findUnique.mockResolvedValue({ id: 21, credits: 44 });
  const token = jwt.sign({ uid: 21 }, process.env.JWT_SECRET || 'development_secret_change_me', { expiresIn: '7d' });
  const verifyReq = request(app).post('/payments/verify').send(verifyBody).set('Content-Type', 'application/json').set('Cookie', `auth_token=${token}`);
  const webhookReq = request(app).post('/payments/razorpay-webhook').set('x-razorpay-signature', sig).set('Content-Type', 'application/json').send(raw);

  const [resVerify, resWebhook] = await Promise.all([verifyReq, webhookReq]);

  expect(resVerify.statusCode === 200 || resVerify.statusCode === 201).toBeTruthy();
  expect(resWebhook.statusCode).toBe(200);
  expect(prisma.creditLedger.create).toHaveBeenCalledTimes(1);
});


