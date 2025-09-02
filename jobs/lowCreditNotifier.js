import cron from 'node-cron';
import prisma from '../lib/prismaClient.js';
import { sendLowCreditEmail } from '../utils/email.js';

export function startLowCreditNotifier() {
  // every 12 hours
  cron.schedule('0 */12 * * *', async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const users = await prisma.user.findMany({
      where: {
        credits: { lt: 10 },
        OR: [
          { lastLowCreditEmailAt: null },
          { lastLowCreditEmailAt: { lt: sevenDaysAgo } }
        ]
      },
      select: { id: true, email: true, username: true, credits: true }
    });
    for (const user of users) {
      try {
        await sendLowCreditEmail(user);
        await prisma.user.update({ where: { id: user.id }, data: { lastLowCreditEmailAt: new Date() } });
      } catch (e) {
        // log
      }
    }
  });
}


