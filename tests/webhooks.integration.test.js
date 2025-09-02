import request from 'supertest';
import crypto from 'crypto';
import { jest } from '@jest/globals';
import app from '../app.js';
import prisma from '../lib/prismaClient.js';

jest.mock('../lib/prismaClient.js');

const PREV_ENV = {};

beforeEach(() => {
  // preserve any existing values
  PREV_ENV.SITE_ID = process.env.SITE_ID;
  PREV_ENV.RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

  // test-specific values
  process.env.SITE_ID = 'ai_ot_helper';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'hook_secret_test';

  jest.resetAllMocks();
  prisma.payment = { findUnique: jest.fn(), update: jest.fn() };
  prisma.webhookEvent = { create: jest.fn(), update: jest.fn() };
  prisma.creditLedger = { findFirst: jest.fn(), create: jest.fn() };
  prisma.user = { update: jest.fn(), findUnique: jest.fn() };

  // Mock $transaction so the transaction callback receives a tx object that
  // uses our mocked methods.
  prisma.$transaction = jest.fn(async (cb) => {
    const tx = { payment: prisma.payment, webhookEvent: prisma.webhookEvent, creditLedger: prisma.creditLedger, user: prisma.user };
    return cb(tx);
  });
});

afterEach(() => {
  // restore previous values
  process.env.SITE_ID = PREV_ENV.SITE_ID;
  process.env.RAZORPAY_WEBHOOK_SECRET = PREV_ENV.RAZORPAY_WEBHOOK_SECRET;
  jest.resetAllMocks();
});

function makeSignature(body) {
  return crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
}

test('processes payment for matching site', async () => {
  const payload = {
    id: 'evt_1',
    event: 'payment.captured',
    payload: {
      payment: { entity: { id: 'pay_1', amount: 5000, order_id: 'order_1', notes: { website_id: 'ai_ot_helper' } } },
      order: { entity: { id: 'order_1', amount: 5000 } }
    }
  };
  const raw = JSON.stringify(payload);

  prisma.payment.findUnique.mockResolvedValue({ id: 1, amountPaise: 5000 });
  prisma.webhookEvent.create.mockResolvedValue({});
  prisma.payment.update.mockResolvedValue({});

  const sig = makeSignature(raw);
  const res = await request(app)
    .post('/payments/razorpay-webhook')
    .set('x-razorpay-signature', sig)
    .set('Content-Type', 'application/json')
    .send(raw);

  expect(res.statusCode).toBe(200);
  expect(prisma.payment.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ status: 'paid' }) })
  );
});

test('ignores event for other site', async () => {
  const payload = {
    id: 'evt_2',
    event: 'payment.captured',
    payload: {
      payment: { entity: { id: 'pay_2', amount: 5000, order_id: 'order_2', notes: { website_id: 'other_site' } } },
      order: { entity: { id: 'order_2', amount: 5000 } }
    }
  };
  const raw = JSON.stringify(payload);

  prisma.webhookEvent.create.mockResolvedValue({});

  const sig = makeSignature(raw);
  const res = await request(app)
    .post('/payments/razorpay-webhook')
    .set('x-razorpay-signature', sig)
    .set('Content-Type', 'application/json')
    .send(raw);

  expect(res.statusCode).toBe(200);
  expect(prisma.payment.update).not.toHaveBeenCalled();
});

test('rejects invalid signature', async () => {
  const payload = { id: 'evt_3', event: 'payment.captured', payload: { payment: { entity: { id: 'pay_3' } } } };
  const raw = JSON.stringify(payload);
  const res = await request(app)
    .post('/payments/razorpay-webhook')
    .set('x-razorpay-signature', 'bad')
    .set('Content-Type', 'application/json')
    .send(raw);

  expect(res.statusCode).toBe(400);
});


