import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orpc } from '../lib/api';
export const useVideoStatus = (enabled: boolean) => useQuery(orpc.video.status.queryOptions({ enabled, refetchInterval: 30000 }));
export const useVideos = (enabled: boolean) => useQuery(orpc.video.list.queryOptions({ enabled, refetchInterval: 10000 }));
export const useUploadImage = () => useMutation(orpc.video.uploadImage.mutationOptions());
export function useCreateVideo() {
  const q = useQueryClient();
  return useMutation(orpc.video.create.mutationOptions({ onSuccess: () => q.invalidateQueries({ queryKey: orpc.video.key() }) }));
}
export const useVideoDownload = () => useMutation(orpc.video.download.mutationOptions());

export const useUploadClip = () => useMutation(orpc.video.uploadClip.mutationOptions());
export function useCreateRecap() {
  const q = useQueryClient();
  return useMutation(orpc.video.createRecap.mutationOptions({ onSuccess: () => q.invalidateQueries({ queryKey: orpc.video.key() }) }));
}
export const useCaptions = () => useMutation(orpc.video.captions.mutationOptions());
