import { authClient } from './auth';
export const authReady = authClient.managedAuth.handleRedirect();