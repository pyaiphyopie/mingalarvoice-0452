import { useQuery, useMutation } from '@tanstack/react-query';
import { orpc } from '../lib/api';
export const useMe = (enabled: boolean) => useQuery(orpc.account.me.queryOptions({ enabled }));
export const useDeleteAccount = () => useMutation(orpc.account.delete.mutationOptions());
