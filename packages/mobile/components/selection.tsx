import { createContext, useContext, useState, type ReactNode } from "react";

// Defaults to ကိုအောင် (Roger), one of the three voices with a real Burmese preview.
const DEFAULT_VOICE = "CwhRBWXzGAHq8TQ4Fs17";
const Ctx = createContext<{ voiceId: string; setVoiceId: (id: string) => void } | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE);
  return <Ctx.Provider value={{ voiceId, setVoiceId }}>{children}</Ctx.Provider>;
}

export function useSelectedVoice() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSelectedVoice must be used inside SelectionProvider");
  return ctx;
}
