import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";

type AudioState = {
  current: string | null;
  playing: boolean;
  buffering: boolean;
  error: string | null;
  /** Clip id whose last playback attempt failed. */
  failedId: string | null;
  /** Toggle play/pause for `id`; `source` resolves a URL lazily (e.g. a 5-minute signed URL). */
  toggle: (id: string, source: () => Promise<string> | string) => Promise<void>;
};

const Ctx = createContext<AudioState | null>(null);
const LOAD_TIMEOUT_MS = 20_000;
const LOAD_FAILED = "This audio could not be loaded. Check your connection and try again.";

/** One shared player so only a single clip plays at a time across Voices and History. */
export function AudioProvider({ children }: { children: ReactNode }) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
  }, []);

  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearLoadTimer = () => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    loadTimer.current = null;
  };
  const fail = useCallback(
    (id: string, message: string) => {
      clearLoadTimer();
      player.pause();
      setCurrent(null);
      setFailedId(id);
      setError(message);
    },
    [player],
  );

  // expo-audio reports no error event: treat a failed native state, or no load in time, as failure.
  useEffect(() => {
    if (!current) return;
    if (status.isLoaded) clearLoadTimer();
    if (/fail|error/i.test(status.playbackState ?? "")) fail(current, LOAD_FAILED);
  }, [current, status.isLoaded, status.playbackState, fail]);

  useEffect(() => clearLoadTimer, []);

  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      player.seekTo(0).catch(() => undefined);
    }
  }, [status.didJustFinish, player]);

  const toggle = useCallback(
    async (id: string, source: () => Promise<string> | string) => {
      setError(null);
      setFailedId(null);
      if (current === id) {
        if (status.playing) player.pause();
        else player.play();
        return;
      }
      clearLoadTimer();
      player.pause();
      setCurrent(id);
      setResolving(true);
      try {
        const uri = await source();
        player.replace({ uri });
        player.play();
        loadTimer.current = setTimeout(() => {
          if (!player.isLoaded && !player.playing) fail(id, LOAD_FAILED);
        }, LOAD_TIMEOUT_MS);
      } catch (e) {
        fail(id, (e as Error)?.message || "This audio could not be played.");
      } finally {
        setResolving(false);
      }
    },
    [current, player, status.playing, fail],
  );

  return (
    <Ctx.Provider value={{ current, playing: status.playing, buffering: resolving || (current !== null && status.isBuffering), error, failedId, toggle }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAudio() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAudio must be used inside AudioProvider");
  return ctx;
}
