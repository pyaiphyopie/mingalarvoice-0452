import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orpc } from '../lib/api';
export const useClones = (enabled: boolean) => useQuery(orpc.clones.list.queryOptions({ enabled, refetchInterval: 60000 }));
export const useUploadSample = () => useMutation(orpc.clones.uploadSample.mutationOptions());
export function useCreateClone() {
  const q = useQueryClient();
  return useMutation(orpc.clones.create.mutationOptions({ onSettled: () => q.invalidateQueries({ queryKey: orpc.clones.key() }) }));
}
export function useDeleteClone() {
  const q = useQueryClient();
  return useMutation(orpc.clones.delete.mutationOptions({ onSettled: () => q.invalidateQueries({ queryKey: orpc.clones.key() }) }));
}
