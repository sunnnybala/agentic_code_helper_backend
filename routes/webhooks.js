import express from 'express';
import prisma from '../lib/prismaClient.js';
import { verifyWebhookSignature } from '../utils/razorpay.js';

const router = express.Router();

// Raw body parser should be applied at route-level in app.js when mounting
router.post('/', async (req, res) => {
  console.log('[WEBHOOK] Incoming webhook request');
  // req.body is a Buffer because express.raw should be used on this route
  const raw = req.body;
  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  console.log('[WEBHOOK] Signature header:', !!signature);
  console.log('[WEBHOOK] Using secret present:', !!secret);

  if (!signature || !verifyWebhookSignature(raw, signature, secret)) {
    console.log('[WEBHOOK] Invalid webhook signature - rejecting');
    return res.status(400).send('invalid signature');
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString());
  } catch (e) {
    console.log('[WEBHOOK] Invalid JSON payload', e && e.message);
    return res.status(400).send('bad payload');
  }

  const eventId = payload?.id || null;
  if (!eventId) {
    console.log('[WEBHOOK] Missing event id');
    return res.status(400).send('missing event id');
  }

  console.log('[WEBHOOK] Event ID:', eventId, 'Event Type:', payload.event);

  // extract site id from notes or receipt
  const siteId = payload?.payload?.payment?.entity?.notes?.website_id
               || (payload?.payload?.order?.entity?.receipt || '').split(':')[0]
               || null;

  console.log('[WEBHOOK] Extracted siteId:', siteId, 'Local SITE_ID:', process.env.SITE_ID);

  const event = payload.event;

  // Use a transaction to create an idempotency marker and perform all state
  // changes (payment update, credit ledger, user balance) atomically. This
  // ensures exactly-once processing even under retries and concurrent workers.
  try {
    await prisma.$transaction(async (tx) => {
      // create idempotency marker - will fail if eventId already exists
      await tx.webhookEvent.create({ data: { eventId, status: 'processing', payload: {} } });
      console.log('[WEBHOOK] Created processing marker for', eventId);

      if (siteId !== process.env.SITE_ID) {
        // mark ignored and exit
        await tx.webhookEvent.update({ where: { eventId }, data: { status: 'ignored', payload } });
        console.log('[WEBHOOK] Ignoring event for other site:', siteId);
        return;
      }

      // find local order within the transaction
      const razorpayOrderId = payload?.payload?.order?.entity?.id || payload?.payload?.payment?.entity?.order_id;
      console.log('[WEBHOOK] Looking up local order for razorpayOrderId:', razorpayOrderId);
      const payment = await tx.payment.findUnique({ where: { razorpayOrderId } });
      if (!payment) {
        await tx.webhookEvent.update({ where: { eventId }, data: { status: 'no_local_order', payload } });
        console.log('[WEBHOOK] No local order match for', { razorpayOrderId });
        return;
      }

      console.log('[WEBHOOK] Local payment record found:', { id: payment.id, amountPaise: payment.amountPaise });

      // verify amount
      const amount = payload?.payload?.payment?.entity?.amount || payload?.payload?.order?.entity?.amount;
      if (amount && amount !== payment.amountPaise) {
        await tx.webhookEvent.update({ where: { eventId }, data: { status: 'amount_mismatch', payload } });
        console.log('[WEBHOOK] Amount mismatch', { expected: payment.amountPaise, received: amount });
        return;
      }

      // process the event depending on type
      console.log('[WEBHOOK] Processing event type:', event);
      if (event === 'payment.captured' || event === 'payment.authorized' || event === 'order.paid') {
        console.log('[WEBHOOK] Marking payment as paid for payment id:', payment.id);
        const razorpayPaymentId = payload?.payload?.payment?.entity?.id || null;

        // Only credit if not already paid/credited. Use a ledger existence check
        // to avoid duplicates in case payment.status may have been updated elsewhere.
        const existingLedger = await tx.creditLedger.findFirst({ where: { relatedId: `razorpay:${razorpayPaymentId}` } });
        if (!existingLedger) {
          await tx.payment.update({ where: { id: payment.id }, data: { status: 'paid', razorpayPaymentId, razorpaySignature: signature } });
          await tx.creditLedger.create({ data: { userId: payment.userId, delta: payment.creditsPurchased, type: 'purchase', reason: 'payment', relatedId: `razorpay:${razorpayPaymentId}` } });
          await tx.user.update({ where: { id: payment.userId }, data: { credits: { increment: payment.creditsPurchased } } });
          console.log('[WEBHOOK] Credited user for payment id:', payment.id, 'credits:', payment.creditsPurchased);
        } else {
          // Ensure payment status updated even if ledger exists
          await tx.payment.update({ where: { id: payment.id }, data: { status: 'paid', razorpayPaymentId, razorpaySignature: signature } });
          console.log('[WEBHOOK] Ledger already exists for razorpayPaymentId:', razorpayPaymentId);
        }

      } else if (event === 'payment.failed') {
        console.log('[WEBHOOK] Marking payment as failed for payment id:', payment.id);
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'failed' } });
      }

      await tx.webhookEvent.update({ where: { eventId }, data: { status: 'processed', payload } });
      console.log('[WEBHOOK] Transaction complete for eventId:', eventId);
    });
  } catch (e) {
    // If the error is a unique constraint on webhookEvent, treat as already-processed
    if (e && e.code === 'P2002') {
      console.log('[WEBHOOK] Event already processing/processed (unique constraint):', eventId);
      return res.status(200).send('ok');
    }
    console.error('[WEBHOOK] Error processing webhook', e && e.message);
    try { await prisma.webhookEvent.update({ where: { eventId }, data: { status: 'error', payload } }); } catch (_) {}
    return res.status(500).send('processing error');
  }

  console.log('[WEBHOOK] Completed processing for', eventId);
  return res.status(200).send('ok');
});

export default router;


