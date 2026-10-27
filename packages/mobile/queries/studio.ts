import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, orpc } from "../lib/api";
import { useSession } from "./session";

export function useCatalog() {
  return useQuery(orpc.studio.catalog.queryOptions({ staleTime: 5 * 60_000 }));
}

export function useWallet() {
  const { signedIn } = useSession();
  return useQuery(orpc.studio.wallet.queryOptions({ enabled: signedIn, refetchInterval: 30_000 }));
}

export function useFavorites() {
  const { signedIn } = useSession();
  return useQuery(orpc.studio.favorites.queryOptions({ enabled: signedIn }));
}

export function useToggleFavorite() {
  const queryClient = useQueryClient();
  const key = orpc.studio.favorites.queryOptions().queryKey;
  return useMutation(
    orpc.studio.favorite.mutationOptions({
      onMutate: async ({ voiceId, saved }) => {
        await queryClient.cancelQueries({ queryKey: key });
        const prev = queryClient.getQueryData(key);
        queryClient.setQueryData(key, (old: any[] | undefined) =>
          saved
            ? [...(old ?? []), { id: `optimistic-${voiceId}`, voiceId }]
            : (old ?? []).filter((f) => f.voiceId !== voiceId),
        );
        return { prev };
      },
      onError: (_e, _v, ctx) => queryClient.setQueryData(key, ctx?.prev),
      onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
    }),
  );
}

const active = (status: string) => status === "queued" || status === "running";

export function useHistory() {
  const { signedIn } = useSession();
  return useQuery(
    orpc.studio.history.queryOptions({
      enabled: signedIn,
      // Poll only while a job is still being produced.
      refetchInterval: (q) => ((q.state.data as any[] | undefined)?.some((j) => active(j.status)) ? 4000 : false),
    }),
  );
}

export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.studio.create.mutationOptions({
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: orpc.studio.history.key() });
        queryClient.invalidateQueries({ queryKey: orpc.studio.wallet.key() });
      },
    }),
  );
}

/** Short-lived signed URL (5 minutes) for one owned, succeeded job. */
export function useDownloadUrl() {
  return useMutation({ mutationFn: (id: string) => client.studio.download({ id }).then((r) => r.url) });
}
