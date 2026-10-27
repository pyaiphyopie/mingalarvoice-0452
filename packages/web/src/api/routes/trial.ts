import { authed } from '../middleware/auth';
import { claimTrial, trialStatus } from '../services/trial';
import { emailConfigured } from '../services/email';

export const trial = {
  status: authed.handler(async ({ context }) => ({ ...(await trialStatus(context.user)), emailConfigured: emailConfigured() })),
  claim: authed.handler(({ context }) => claimTrial(context.user)),
};
