import nodemailer from 'nodemailer';

let transporter;

// Returns a real Nodemailer transporter when SMTP is configured, otherwise
// returns a no-op transporter that resolves immediately. This allows the
// application to run without SMTP configured and makes it easy to enable
// email later without code changes.
export function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  if (!host) {
    transporter = {
      // noop sendMail for environments without SMTP
      sendMail: async (mail) => {
        console.warn('[EMAIL] SMTP not configured; skipping send', { to: mail.to });
        return { accepted: [], rejected: [] };
      }
    };
    return transporter;
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = port === 465; // implicit TLS on 465

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  return transporter;
}

export async function sendLowCreditEmail(user) {
  if (!user.email) return;
  const mail = {
    from: process.env.EMAIL_FROM || 'no-reply@example.com',
    to: user.email,
    subject: 'Low credits warning',
    text: `Hi ${user.username}, your credit balance is ${user.credits}. Please top up to continue using the app.`,
  };

  try {
    await getTransporter().sendMail(mail);
  } catch (e) {
    // Don't throw in case of email failures; log and continue.
    console.warn('[EMAIL] Failed to send low credit email', { to: user.email, error: e && e.message });
  }
}


