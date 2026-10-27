import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { orpc } from '../lib/api';
export const useOwnerStatus = (enabled: boolean) => useQuery(orpc.owner.status.queryOptions({ enabled }));
export function useApprovePayment() {
  const query = useQueryClient();
  return useMutation(orpc.owner.approve.mutationOptions({ gcTime: 0, onSuccess: () => {
    query.invalidateQueries({ queryKey: orpc.paymentOrders.key() });
    query.invalidateQueries({ queryKey: orpc.studio.wallet.key() });
  } }));
}
export const useApprovals = () => useMutation(orpc.owner.approvals.mutationOptions({ gcTime: 0 }));