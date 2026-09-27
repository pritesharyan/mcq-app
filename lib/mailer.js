const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;

  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return transporter;
}

// Sends an email if SMTP is configured in .env; otherwise logs it to the
// console so the flow can still be tested locally without real email setup.
async function sendMail({ to, subject, text }) {
  const t = getTransporter();
  if (!t) {
    console.log('--- SMTP not configured, printing email instead of sending ---');
    console.log(`To: ${to}\nSubject: ${subject}\n\n${text}`);
    console.log('--- end email ---');
    return { sent: false, logged: true };
  }

  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to, subject, text
  });
  return { sent: true };
}

module.exports = { sendMail };
