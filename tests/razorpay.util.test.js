import crypto from 'crypto';
import { verifyWebhookSignature } from '../utils/razorpay.js';

describe('verifyWebhookSignature', () => {
  test('returns true for correct signature', () => {
    const secret = 'test_secret';
    const raw = Buffer.from(JSON.stringify({ hello: 'world' }));
    const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    expect(verifyWebhookSignature(raw, sig, secret)).toBe(true);
  });

  test('returns false for incorrect signature', () => {
    const raw = Buffer.from(JSON.stringify({ hello: 'world' }));
    expect(verifyWebhookSignature(raw, 'bad', 'test_secret')).toBe(false);
  });
});


