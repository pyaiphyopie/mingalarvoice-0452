import { z } from 'zod';
import { authed } from '../middleware/auth';
import { deleteAccount } from '../services/account';

export const account = {
  /** Session details the clients use to decide whether re-authentication is needed before deletion. */
  me: authed.handler(({ context }) => ({
    id: context.user.id,
    email: context.user.email,
    name: context.user.name,
    sessionCreatedAt: new Date(context.session.createdAt).getTime(),
  })),
  delete: authed
    .input(z.object({ confirm: z.literal('DELETE') }))
    .handler(({ context }) => deleteAccount(context.user.id, context.session.createdAt)),
};
