import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orpc } from '../lib/api';
export const usePaymentOrders = (enabled: boolean) => useQuery(orpc.paymentOrders.list.queryOptions({ enabled, refetchInterval: 15000 }));
export const useCreateOrder = () => useMutation(orpc.paymentOrders.create.mutationOptions());
export function useSubmitOrder() {
  const query = useQueryClient();
  return useMutation(orpc.paymentOrders.submit.mutationOptions({ onSuccess: () => query.invalidateQueries({ queryKey: orpc.paymentOrders.key() }) }));
}
export const usePendingOrders = () => useMutation(orpc.owner.pendingOrders.mutationOptions({ gcTime: 0 }));
export const useRejectOrder = () => useMutation(orpc.owner.rejectOrder.mutationOptions({ gcTime: 0 }));