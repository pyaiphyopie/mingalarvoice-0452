import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orpc } from '../lib/api';
export const useCatalog = () => useQuery(orpc.studio.catalog.queryOptions({ staleTime: 300000 }));
export const useWallet = (enabled: boolean) => useQuery(orpc.studio.wallet.queryOptions({ enabled, refetchInterval: 15000 }));
export const useHistory = (enabled: boolean) => useQuery(orpc.studio.history.queryOptions({ enabled, refetchInterval: 10000 }));
export const useFavorites = (enabled: boolean) => useQuery(orpc.studio.favorites.queryOptions({ enabled }));
export function useFavorite() {
  const q = useQueryClient();
  return useMutation(orpc.studio.favorite.mutationOptions({ onSuccess: () => q.invalidateQueries({ queryKey: orpc.studio.favorites.key() }) }));
}
export const useGenerate = () => useMutation(orpc.studio.create.mutationOptions());
export const useDownload = () => useMutation(orpc.studio.download.mutationOptions());