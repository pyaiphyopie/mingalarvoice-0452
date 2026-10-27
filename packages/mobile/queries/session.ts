import { authClient } from "../lib/auth";

/** Reactive Better Auth session; `signedIn` gates every owned-data query. */
export function useSession() {
  const session = authClient.useSession();
  return { ...session, signedIn: !!session.data?.user };
}
