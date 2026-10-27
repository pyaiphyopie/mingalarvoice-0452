import { createAuthClient } from 'better-auth/react';
import { managedAuthClient } from '@runablehq/managed-auth/client';
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_WEBSITE_URL ?? window.location.origin,
  basePath: '/api/auth',
  plugins: [managedAuthClient({ applicationId: import.meta.env.VITE_APPLICATION_ID, issuer: import.meta.env.VITE_RUNABLE_AUTH_ISSUER })],
});