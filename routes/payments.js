import express from 'express';
import { z } from 'zod';
import prisma from '../lib/prismaClient.js';
import { getRazorpay, verifyRazorpaySignature } from '../utils/razorpay.js';
import { creditCredits } from '../services/credits.js';
import { requireAuth } from '../middlewares/auth.js';

const router = express.Router();

const createOrderSchema = z.object({ credits: z.number().int().min(1) });

router.post('/create-order', requireAuth, async (req, res, next) => {
  try {
    console.log('[PAYMENTS] Create order attempt', { userId: req.user?.id, body: req.body });
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { credits } = createOrderSchema.parse(req.body);
    const amountPaise = credits * 5 * 100; // ₹5 per credit
    const razorpay = getRazorpay();
    // include site id and structured receipt to link order to this site
    const siteId = process.env.SITE_ID || 'unknown_site';
    const receipt = `${siteId}:u${userId}:${Date.now()}`;
    const order = await razorpay.orders.create({ amount: amountPaise, currency: 'INR', receipt, notes: { website_id: siteId } });
    await prisma.payment.create({ data: { userId, razorpayOrderId: order.id, amountPaise, creditsPurchased: credits, status: 'created' } });
    console.log('[PAYMENTS] Order created', { orderId: order.id, amountPaise, userId });
    return res.json({ success: true, orderId: order.id, amount: amountPaise, currency: 'INR', razorpayKeyId: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Invalid input' });
    }
    next(err);
  }
});

const verifySchema = z.object({
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string()
});

router.post('/verify', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = verifySchema.parse(req.body);
    if (!verifyRazorpaySignature({ orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature })) {
      return res.status(400).json({ success: false, error: 'Invalid signature' });
    }
    const payment = await prisma.payment.findUnique({ where: { razorpayOrderId: razorpay_order_id } });
    if (!payment || payment.userId !== userId) return res.status(404).json({ success: false, error: 'Payment not found' });
    if (payment.status === 'paid') {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { credits: true } });
      return res.json({ success: true, creditsAdded: 0, balance: user.credits });
    }

    // Record provider metadata but do NOT perform crediting here. Crediting
    // will be performed only by the webhook handler to avoid race conditions
    // and duplicate credits when verify and webhook are processed concurrently.
    await prisma.payment.update({ where: { razorpayOrderId: razorpay_order_id }, data: { razorpayPaymentId: razorpay_payment_id, razorpaySignature: razorpay_signature } });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { credits: true } });
    return res.json({ success: true, creditsAdded: 0, balance: user.credits, message: 'Payment verified; credits will be applied once webhook is processed' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Invalid input' });
    }
    next(err);
  }
});

export default router;


