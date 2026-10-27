/** Transactional email through Resend's HTTP API. Disabled (returns false) until RESEND_API_KEY and EMAIL_FROM are set. */
export const emailConfigured = () => !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;

export async function sendEmail(input: { to: string; subject: string; html: string; text: string }) {
  if (!emailConfigured()) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [input.to], subject: input.subject, html: input.html, text: input.text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Email provider rejected the message (${response.status})`);
  return true;
}

const escape = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
export function verificationEmail(url: string) {
  return {
    subject: 'Mingalar Voice — confirm your email / အီးမေးလ် အတည်ပြုပါ',
    text: `Confirm your email to unlock your free 180-credit trial:\n${url}\n\nIf you did not create a Mingalar Voice account, ignore this email.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px"><h2>Mingalar Voice</h2><p>အခမဲ့ ၁၈၀ ခရက်ဒစ် (၃ မိနစ်) ရယူရန် သင့်အီးမေးလ်ကို အတည်ပြုပါ။</p><p>Confirm your email to unlock your free 180-credit trial.</p><p><a href="${escape(url)}" style="background:#1b1b1b;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Confirm email</a></p><p style="color:#666;font-size:12px">If you did not create an account, ignore this email.</p></div>`,
  };
}
