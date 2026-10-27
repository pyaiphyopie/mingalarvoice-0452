import { useMutation, useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import { useSession } from "./session";

export function useMe() {
  const { signedIn } = useSession();
  return useQuery(orpc.account.me.queryOptions({ enabled: signedIn }));
}

export function useDeleteAccount() {
  return useMutation(orpc.account.delete.mutationOptions());
}
