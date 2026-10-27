import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orpc } from '../lib/api';
/** Server price list — the same numbers the order and approval code charge. */
export const usePlans = () => useQuery(orpc.paymentOrders.plans.queryOptions({ staleTime: 600000 }));
export const useTrialStatus = (enabled: boolean) => useQuery(orpc.trial.status.queryOptions({ enabled }));
export function useClaimTrial() {
  const q = useQueryClient();
  return useMutation(orpc.trial.claim.mutationOptions({ onSuccess: () => {
    q.invalidateQueries({ queryKey: orpc.trial.key() });
    q.invalidateQueries({ queryKey: orpc.studio.wallet.key() });
  } }));
}
