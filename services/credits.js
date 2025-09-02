import prisma from '../lib/prismaClient.js';

const MODEL_CREDIT_COST = {
  'gpt-5': 10,
  'gpt-5-mini': 3,
  'gpt-5-nano': 1,
  'gemini-2.0-flash': 1,
  'gemini-2.5-pro': 5,
  'claude-3.5-sonnet': 4,
  'claude-3.5-haiku': 3
};

export function getRequiredCredits(model) {
  return MODEL_CREDIT_COST[model] ?? 1;
}

export async function creditCredits(userId, amount, reason, relatedId) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: userId }, data: { credits: { increment: amount } } });
    await tx.creditLedger.create({ data: { userId, delta: amount, type: 'purchase', reason, relatedId } });
    return user;
  });
}

export async function debitCredits(userId, amount, reason, relatedId) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { credits: true } });
    if (!user || user.credits < amount) {
      const err = new Error('Insufficient credits');
      err.statusCode = 402;
      throw err;
    }
    const updated = await tx.user.update({ where: { id: userId }, data: { credits: { decrement: amount } } });
    await tx.creditLedger.create({ data: { userId, delta: -amount, type: 'debit', reason, relatedId } });
    return updated;
  });
}


