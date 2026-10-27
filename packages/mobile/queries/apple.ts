import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import { useSession } from "./session";

/** Server-side App Store switch, allowlisted product IDs and this user's appAccountToken. No prices. */
export function useAppleConfig() {
  const { signedIn } = useSession();
  return useQuery(orpc.apple.config.queryOptions({ enabled: signedIn }));
}

export function useApplePurchases() {
  const { signedIn } = useSession();
  return useQuery(orpc.apple.purchases.queryOptions({ enabled: signedIn }));
}

export function useRedeem() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.apple.redeem.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.studio.wallet.key() });
        queryClient.invalidateQueries({ queryKey: orpc.apple.purchases.key() });
      },
    }),
  );
}
