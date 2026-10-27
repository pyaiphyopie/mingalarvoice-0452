import { useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useColors } from "../../hooks/use-colors";
import { useCatalog, useFavorites, useToggleFavorite } from "../../queries/studio";
import { useSession } from "../../queries/session";
import { useSelectedVoice } from "../../components/selection";
import { useAudio } from "../../components/audio";
import { VoiceRow, type CatalogVoice } from "../../components/voice-row";
import { Body, Button, Chip, GUTTER, Loading, Notice, Title, errorMessage } from "../../components/ui";

type Filter = "all" | "previews" | "favorites";

export default function VoicesScreen() {
  const c = useColors();
  const router = useRouter();
  const { signedIn } = useSession();
  const catalog = useCatalog();
  const favorites = useFavorites();
  const toggle = useToggleFavorite();
  const audio = useAudio();
  const { voiceId, setVoiceId } = useSelectedVoice();
  const [filter, setFilter] = useState<Filter>("all");

  const saved = useMemo(() => new Set((favorites.data ?? []).map((f) => f.voiceId)), [favorites.data]);
  const voices = (catalog.data?.voices ?? []) as CatalogVoice[];
  const shown = voices
    .filter((v) => (filter === "previews" ? !!v.preview : filter === "favorites" ? saved.has(v.voice_id) : true))
    // Voices with a real Burmese preview first, so the listenable ones lead.
    .sort((a, b) => Number(!!b.preview) - Number(!!a.preview));

  const header = (
    <View>
      <Title my="မြန်မာအသံများ">Voices</Title>
      <Body muted style={{ marginBottom: 14, fontSize: 14 }}>
        Every voice speaks your script in Burmese. Names are display aliases; only three voices have a recorded Burmese preview so far.
      </Body>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <Chip label="ALL" active={filter === "all"} onPress={() => setFilter("all")} />
        <Chip label="BURMESE PREVIEWS" active={filter === "previews"} onPress={() => setFilter("previews")} />
        <Chip label="FAVORITES" active={filter === "favorites"} onPress={() => setFilter("favorites")} />
      </View>
      {audio.error && <Notice tone="danger" title="Preview could not play">{audio.error}</Notice>}
      {filter === "favorites" && !signedIn && (
        <Notice title="Sign in to keep favorites" action={<Button label="Sign in" compact onPress={() => router.push("/sign-in")} />}>
          Favorites are saved to your account and sync with the website.
        </Notice>
      )}
    </View>
  );

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: c.background }}>
      <FlatList
        data={shown}
        keyExtractor={(v) => v.voice_id}
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 40 }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          catalog.isLoading ? (
            <Loading />
          ) : catalog.isError ? (
            <Notice tone="danger" title="Voices could not load" action={<Button label="Retry" compact variant="outline" onPress={() => catalog.refetch()} />}>
              {errorMessage(catalog.error)}
            </Notice>
          ) : filter === "favorites" && signedIn ? (
            <Body muted>No favorites yet. Tap a heart to save a voice.</Body>
          ) : undefined
        }
        renderItem={({ item }) => (
          <VoiceRow
            voice={item}
            selected={item.voice_id === voiceId}
            favorite={saved.has(item.voice_id)}
            onSelect={() => {
              setVoiceId(item.voice_id);
              router.navigate("/");
            }}
            onFavorite={() => {
              if (!signedIn) return router.push("/sign-in");
              toggle.mutate({ voiceId: item.voice_id, saved: !saved.has(item.voice_id) });
            }}
          />
        )}
      />
    </SafeAreaView>
  );
}
