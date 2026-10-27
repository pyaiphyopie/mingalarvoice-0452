import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { expo } from '@better-auth/expo';
import { runableManagedAuth } from '@runablehq/managed-auth/server';
import { db } from './database';
import { emailConfigured, sendEmail, verificationEmail } from './services/email';

const website = process.env.WEBSITE_URL!;
// Expo web preview runs on the mobile port of the same preview host.
const mobilePreview = website.replace('-preview-4200.', '-preview-4300.');
const nativeScheme = `runable-${process.env.APPLICATION_ID}://`;

export const auth = betterAuth({
  basePath: '/api/auth',
  baseURL: website,
  database: drizzleAdapter(db, { provider: 'sqlite' }),
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  // Verified email unlocks the one-time trial. Managed (Google) sign-in arrives already verified.
  emailVerification: {
    sendOnSignUp: emailConfigured(),
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => { await sendEmail({ to: user.email, ...verificationEmail(url) }); },
  },
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [website, 'http://localhost:4200', mobilePreview, 'http://localhost:4300', nativeScheme, 'exp://*'],
  plugins: [...runableManagedAuth({ applicationId: process.env.APPLICATION_ID!, issuer: process.env.VITE_RUNABLE_AUTH_ISSUER! }), expo()],
});
