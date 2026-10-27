import { useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Fonts } from "../../constants/theme";
import { useColors } from "../../hooks/use-colors";
import { useSession } from "../../queries/session";
import { useDownloadUrl, useHistory } from "../../queries/studio";
import { useAudio } from "../../components/audio";
import { voiceName } from "../../lib/voice-names";
import { shareAudio } from "../../lib/share-audio";
import { Body, Button, Chip, GUTTER, Label, Loading, My, Notice, Title, errorMessage } from "../../components/ui";

const RETENTION_MS = 30 * 86_400_000;

type Job = {
  id: string;
  text: string;
  voiceId: string;
  status: string;
  cost: number;
  actualCost: number | null;
  durationMs: number | null;
  createdAt: number;
  error: string | null;
};

export default function HistoryScreen() {
  const c = useColors();
  const router = useRouter();
  const { signedIn, isPending } = useSession();
  const history = useHistory();

  if (!isPending && !signedIn) {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: c.background, paddingHorizontal: GUTTER }}>
        <Title my="ထုတ်လုပ်ခဲ့သော အသံများ">History</Title>
        <Notice title="Sign in to see your narrations" action={<Button label="Sign in" compact onPress={() => router.push("/sign-in")} />}>
          Your generated audio is private to your account.
        </Notice>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: c.background }}>
      <FlatList
        data={(history.data ?? []) as Job[]}
        keyExtractor={(j) => j.id}
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={history.isRefetching} onRefresh={() => void history.refetch()} tintColor={c.foreground} />}
        ListHeaderComponent={
          <View>
            <Title my="ထုတ်လုပ်ခဲ့သော အသံများ">History</Title>
            <Body muted style={{ fontSize: 14, marginBottom: 16 }}>
              Audio stays downloadable for 30 days after it is created.
            </Body>
          </View>
        }
        ListEmptyComponent={
          history.isLoading ? (
            <Loading />
          ) : history.isError ? (
            <Notice tone="danger" title="History could not load" action={<Button label="Retry" compact variant="outline" onPress={() => history.refetch()} />}>
              {errorMessage(history.error)}
            </Notice>
          ) : (
            <Notice title="No narrations yet" action={<Button label="Open Studio" compact variant="outline" onPress={() => router.navigate("/")} />}>
              Generated audio will appear here.
            </Notice>
          )
        }
        renderItem={({ item }) => <JobRow job={item} />}
      />
    </SafeAreaView>
  );
}

function JobRow({ job }: { job: Job }) {
  const c = useColors();
  const audio = useAudio();
  const download = useDownloadUrl();
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const expired = job.createdAt + RETENTION_MS < Date.now();
  const playable = job.status === "succeeded" && !expired;
  const id = `job:${job.id}`;
  const mine = audio.current === id;

  const status = {
    queued: { label: "QUEUED", color: c.mutedForeground },
    running: { label: "GENERATING", color: c.foreground },
    succeeded: { label: expired ? "EXPIRED" : "READY", color: expired ? c.mutedForeground : c.success },
    failed: { label: "FAILED", color: c.destructive },
    uncertain: { label: "UNDER REVIEW", color: c.warning },
  }[job.status] ?? { label: job.status.toUpperCase(), color: c.mutedForeground };

  const detail =
    job.status === "succeeded"
      ? `${((job.durationMs ?? 0) / 1000).toFixed(1)} s · charged ${job.actualCost ?? 0} of ${job.cost} reserved`
      : job.status === "failed"
        ? `${job.error ?? "Generation failed."} All ${job.cost} reserved credits were returned.`
        : job.status === "uncertain"
          ? `${job.error ?? "Outcome unclear."} ${job.cost} credits stay reserved until it is reviewed; it will not be retried automatically.`
          : `${job.cost} credits reserved`;

  return (
    <View style={[styles.row, { borderColor: c.border, backgroundColor: c.card }]}>
      <View style={styles.head}>
        <Chip label={status.label} color={status.color} />
        <Label>{new Date(job.createdAt).toLocaleString()}</Label>
      </View>
      <My numberOfLines={3} style={{ fontSize: 15, marginTop: 8 }}>
        {job.text}
      </My>
      <Text style={{ fontFamily: Fonts.regular, fontSize: 13, color: c.mutedForeground }}>
        <Text style={{ fontFamily: Fonts.my }}>{voiceName(job.voiceId)}</Text> · {detail}
      </Text>
      {(job.status === "queued" || job.status === "running") && <ActivityIndicator style={{ alignSelf: "flex-start", marginTop: 8 }} color={c.foreground} />}
      {job.status === "uncertain" && (
        <Body muted style={{ fontSize: 13, marginTop: 6 }}>
          Questions? Email support from the Account tab with this ID: {job.id}
        </Body>
      )}
      {playable && (
        <View style={styles.actions}>
          <Button
            compact
            variant="accent"
            icon={mine && audio.playing ? "pause" : "play"}
            label={mine && audio.playing ? "Pause" : "Play"}
            loading={mine && audio.buffering}
            onPress={() => audio.toggle(id, () => download.mutateAsync(job.id))}
          />
          <Button
            compact
            variant="outline"
            icon="share-outline"
            label="Share"
            loading={sharing}
            onPress={async () => {
              setShareError(null);
              setSharing(true);
              try {
                await shareAudio(await download.mutateAsync(job.id), job.id);
              } catch (e) {
                setShareError(errorMessage(e));
              } finally {
                setSharing(false);
              }
            }}
          />
        </View>
      )}
      {(shareError || (audio.failedId === id && audio.error)) && <Body style={{ color: c.destructive, fontSize: 13, marginTop: 8 }}>{shareError ?? audio.error}</Body>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 10 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
});
