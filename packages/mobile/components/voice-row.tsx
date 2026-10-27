import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Fonts } from "../constants/theme";
import { useColors } from "../hooks/use-colors";
import { absoluteUrl } from "../lib/config";
import { voiceName } from "../lib/voice-names";
import { useAudio } from "./audio";
import { Body, Chip, Label, My } from "./ui";

export type CatalogVoice = {
  voice_id: string;
  name: string;
  labels: Record<string, string>;
  preview: { url: string; captions: string; text: string; language: "my" } | null;
};

/** Plays only a locally generated Burmese preview for this exact provider voice — never a substitute. */
export function PreviewButton({ voice }: { voice: CatalogVoice }) {
  const c = useColors();
  const audio = useAudio();
  if (!voice.preview) return null;
  const id = `preview:${voice.voice_id}`;
  const mine = audio.current === id;
  const busy = mine && audio.buffering;
  const playing = mine && audio.playing;
  const url = absoluteUrl(voice.preview.url);
  return (
    <Pressable
      onPress={() => audio.toggle(id, () => url)}
      accessibilityRole="button"
      accessibilityLabel={`${playing ? "Pause" : "Play"} Burmese preview of ${voice.name}`}
      style={[styles.play, { backgroundColor: c.accent }]}
    >
      {busy ? <ActivityIndicator color={c.accentForeground} /> : <Ionicons name={playing ? "pause" : "play"} size={20} color={c.accentForeground} />}
    </Pressable>
  );
}

export function VoiceRow({
  voice,
  selected,
  favorite,
  onSelect,
  onFavorite,
}: {
  voice: CatalogVoice;
  selected: boolean;
  favorite: boolean;
  onSelect: () => void;
  onFavorite: () => void;
}) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const traits = ["gender", "age", "accent"].map((k) => voice.labels[k]).filter(Boolean).slice(0, 3);
  return (
    <View style={[styles.row, { borderColor: selected ? c.foreground : c.border, backgroundColor: c.card }]}>
      <View style={styles.top}>
        <PreviewButton voice={voice} />
        <Pressable style={{ flex: 1 }} onPress={onSelect} accessibilityRole="button" accessibilityLabel={`Use ${voice.name}`}>
          <My bold style={{ fontSize: 18 }}>{voiceName(voice.voice_id)}</My>
          <Text style={{ fontFamily: Fonts.regular, color: c.mutedForeground, fontSize: 13 }}>
            {voice.name} · Burmese output
          </Text>
        </Pressable>
        <Pressable
          onPress={onFavorite}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={favorite ? `Remove ${voice.name} from favorites` : `Save ${voice.name} to favorites`}
          accessibilityState={{ selected: favorite }}
        >
          <Ionicons name={favorite ? "heart" : "heart-outline"} size={24} color={favorite ? c.destructive : c.mutedForeground} />
        </Pressable>
      </View>
      <View style={styles.meta}>
        {traits.map((t) => (
          <Chip key={t} label={t} />
        ))}
        {selected ? <Chip label="SELECTED" active /> : <Chip label="USE VOICE" onPress={onSelect} />}
      </View>
      {voice.preview ? (
        <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ marginTop: 10 }}>
          <Label>{open ? "Hide transcript ▲" : "Burmese preview · transcript ▼"}</Label>
          {open && <My style={{ fontSize: 14, marginTop: 6 }}>{voice.preview.text}</My>}
        </Pressable>
      ) : (
        <Body muted style={{ fontSize: 13, marginTop: 10 }}>
          Burmese preview unavailable
        </Body>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderWidth: 1.5, borderRadius: 10, padding: 14, marginBottom: 10 },
  top: { flexDirection: "row", alignItems: "center", gap: 12 },
  meta: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  play: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
