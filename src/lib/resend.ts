import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL ?? "noreply@realflowai.com";

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string | string[];
  subject: string;
  html: string;
}) {
  return resend.emails.send({ from: FROM, to, subject, html });
}

export async function sendPaymentFailedEmail(to: string) {
  return sendEmail({
    to,
    subject: "Payment failed — action required",
    html: `<p>Your last payment failed. Please update your billing details to continue using RealFlow AI.</p>`,
  });
}

export async function sendWelcomeEmail(to: string, name: string) {
  return sendEmail({
    to,
    subject: "Welcome to RealFlow AI!",
    html: `<p>Hi ${name}, welcome to RealFlow AI. Your 14-day trial has started.</p>`,
  });
}

export async function sendTrialEndingEmail(to: string, daysLeft: number) {
  return sendEmail({
    to,
    subject: `Your trial ends in ${daysLeft} days`,
    html: `<p>Your RealFlow AI trial ends in ${daysLeft} days. Upgrade now to keep access.</p>`,
  });
}
