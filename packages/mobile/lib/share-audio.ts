import { Linking, Platform } from "react-native";

/** Downloads a signed MP3 into the cache and opens the iOS share sheet (web: opens the file). */
export async function shareAudio(url: string, jobId: string) {
  if (Platform.OS === "web") {
    await Linking.openURL(url);
    return;
  }
  const [{ File, Paths }, Sharing] = await Promise.all([import("expo-file-system"), import("expo-sharing")]);
  const target = new File(Paths.cache, `mingalar-voice-${jobId.slice(0, 8)}.mp3`);
  if (target.exists) target.delete();
  const file = await File.downloadFileAsync(url, target);
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this device.");
  await Sharing.shareAsync(file.uri, { mimeType: "audio/mpeg", UTI: "public.mp3", dialogTitle: "Share narration" });
}

/** Removes narration copies left in the cache by sharing (called on sign-out and account deletion). */
export async function clearSharedAudio() {
  if (Platform.OS === "web") return;
  try {
    const { Directory, File, Paths } = await import("expo-file-system");
    for (const entry of new Directory(Paths.cache).list()) {
      if (entry instanceof File && entry.name.startsWith("mingalar-voice-") && entry.name.endsWith(".mp3")) entry.delete();
    }
  } catch {
    // Best effort: the OS may also purge the cache directory.
  }
}
