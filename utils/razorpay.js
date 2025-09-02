import Razorpay from 'razorpay';
import crypto from 'crypto';

export function getRazorpay() {
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
}

export function verifyRazorpaySignature({ orderId, paymentId, signature }) {
  const body = `${orderId}|${paymentId}`;
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(body).digest('hex');
  return expected === signature;
}

export function verifyWebhookSignature(rawBody, signature, secret) {
  try {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return expected === signature;
  } catch (e) {
    return false;
  }
}


