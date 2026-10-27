import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import { Ionicons } from "@expo/vector-icons";
import { Fonts } from "../../constants/theme";
import { useColors } from "../../hooks/use-colors";
import { useSession } from "../../queries/session";
import { useCatalog, useCreateJob, useWallet } from "../../queries/studio";
import { useSelectedVoice } from "../../components/selection";
import { PreviewButton, type CatalogVoice } from "../../components/voice-row";
import { voiceName } from "../../lib/voice-names";
import { Body, Button, Card, GUTTER, Label, My, Notice, Title, errorMessage } from "../../components/ui";

const MAX_CHARS = 2000;
const MAX_RESERVE = 600;
const hasBurmese = (s: string) => /[က-႟ꩠ-ꩿ]/.test(s);

export default function StudioScreen() {
  const c = useColors();
  const router = useRouter();
  const { signedIn, isPending } = useSession();
  const catalog = useCatalog();
  const wallet = useWallet();
  const create = useCreateJob();
  const { voiceId } = useSelectedVoice();
  const [text, setText] = useState("");
  const [reserve, setReserve] = useState(30);
  const [done, setDone] = useState<string | null>(null);
  const key = useRef<string>(Crypto.randomUUID());

  const chars = [...text.trim()].length;
  const minimum = Math.max(10, Math.ceil(chars / 4));
  useEffect(() => {
    const floor = Math.min(MAX_RESERVE, minimum);
    if (reserve < floor) setReserve(floor);
  }, [minimum, reserve]);
  // A new request key whenever the request changes; a retry of the same request reuses it,
  // so a network retry can never reserve credits twice.
  useEffect(() => {
    key.current = Crypto.randomUUID();
  }, [text, voiceId, reserve]);

  const voice = (catalog.data?.voices as CatalogVoice[] | undefined)?.find((v) => v.voice_id === voiceId);
  const w = wallet.data;
  const planActive = w?.subscription?.status === "active" && (w.subscription.periodEnd ?? 0) > Date.now();
  const webUsable = planActive ? (w?.available ?? 0) : 0;
  const appleUsable = w?.apple.available ?? 0;
  const usable = webUsable + appleUsable;
  // The server reserves from one balance per narration (active plan first, then App Store),
  // so the largest single balance — not the sum — limits a reservation.
  const largest = Math.max(webUsable, appleUsable);
  const ready = !!w?.generationReady;

  const blocker = useMemo(() => {
    if (!signedIn) return "signin";
    if (wallet.isLoading) return "loading";
    if (wallet.isError) return "error";
    if (!ready) return "paused";
    if (usable <= 0) return "empty";
    return null;
  }, [signedIn, wallet.isLoading, wallet.isError, ready, usable]);

  const problems = [
    chars === 0 && "Write a script.",
    chars > 0 && !hasBurmese(text) && "Add Burmese text to your script.",
    chars > MAX_CHARS && `Keep it under ${MAX_CHARS.toLocaleString()} characters.`,
    minimum > MAX_RESERVE && "This script is too long for one narration.",
    !voice && (catalog.isLoading ? "Loading voices…" : "Choose an available voice."),
    signedIn && w && reserve > largest &&
      (webUsable > 0 && appleUsable > 0 && reserve <= usable
        ? `One balance must cover the whole reservation. Your largest balance is ${largest.toLocaleString()} credits.`
        : "Not enough credits for this reservation."),
  ].filter(Boolean) as string[];

  const submit = () => {
    setDone(null);
    create.mutate(
      { text, voiceId, maxCredits: reserve, idempotency: key.current },
      {
        onSuccess: () => {
          setDone("Queued. Follow progress in History.");
          setText("");
        },
      },
    );
  };

  const step = (delta: number) => setReserve((r) => Math.min(MAX_RESERVE, Math.max(Math.min(MAX_RESERVE, minimum), r + delta)));

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <Title my="စာသားမှ မြန်မာအသံသို့">Studio</Title>

          {!isPending && blocker === "signin" && (
            <Notice title="Sign in to generate" action={<Button label="Sign in" compact onPress={() => router.push("/sign-in")} />}>
              You can write and preview voices now. Generating narration needs an account and credits.
            </Notice>
          )}
          {blocker === "error" && (
            <Notice tone="danger" title="Your balance could not load" action={<Button label="Retry" compact variant="outline" onPress={() => wallet.refetch()} />}>
              {errorMessage(wallet.error)}
            </Notice>
          )}
          {blocker === "paused" && (
            <Notice tone="warning" title="Generation is paused">
              The narration worker is offline or generation is switched off. Nothing will be reserved until it is back.
            </Notice>
          )}
          {blocker === "empty" && (
            <Notice title="No credits available" action={<Button label="View credits" compact variant="outline" onPress={() => router.navigate("/credits")} />}>
              Add App Store credits to start generating narration.
            </Notice>
          )}

          <Card tint="ink" style={{ marginBottom: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              {voice && <PreviewButton voice={voice} />}
              <View style={{ flex: 1 }}>
                <Label style={{ color: c.accent }}>Voice</Label>
                <My bold style={{ color: c.primaryForeground, fontSize: 18 }}>{voiceName(voiceId)}</My>
                <Text style={{ color: c.primaryForeground, opacity: 0.7, fontFamily: Fonts.regular, fontSize: 13 }}>
                  {voice ? `${voice.name} · Burmese output` : catalog.isLoading ? "Loading voices…" : "Voice unavailable"}
                </Text>
              </View>
              <Button label="Change" compact variant="accent" onPress={() => router.navigate("/voices")} />
            </View>
          </Card>

          <View style={[styles.editor, { borderColor: c.border, backgroundColor: c.card }]}>
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              placeholder="မင်္ဂလာပါ။ ဒီနေရာမှာ သင့်ဇာတ်ညွှန်းကို ရေးပါ…"
              placeholderTextColor={c.mutedForeground}
              accessibilityLabel="Burmese script"
              style={[styles.input, { color: c.foreground }]}
              textAlignVertical="top"
            />
            <View style={styles.editorFoot}>
              <Label>Burmese script</Label>
              <Label style={{ color: chars > MAX_CHARS ? c.destructive : c.mutedForeground }}>
                {chars.toLocaleString()} / {MAX_CHARS.toLocaleString()}
              </Label>
            </View>
          </View>

          <View style={[styles.reserve, { borderColor: c.border }]}>
            <View style={{ flex: 1 }}>
              <Label>Maximum reservation</Label>
              <Text style={[styles.reserveValue, { color: c.foreground }]}>{reserve} credits</Text>
              <Body muted style={{ fontSize: 13 }}>
                ≈ {reserve} seconds of audio. You pay for measured seconds; the rest returns automatically.
              </Body>
            </View>
            <View style={{ gap: 8 }}>
              <Stepper icon="add" label="Increase reservation" onPress={() => step(10)} disabled={reserve >= MAX_RESERVE} />
              <Stepper icon="remove" label="Decrease reservation" onPress={() => step(-10)} disabled={reserve <= minimum} />
            </View>
          </View>
          {signedIn && w && (
            <Body muted style={{ fontSize: 13, marginBottom: 14 }}>
              Usable now: {usable.toLocaleString()} credits{w.apple.reserved + w.reserved > 0 ? ` · ${(w.apple.reserved + w.reserved).toLocaleString()} held for narrations in progress` : ""}
            </Body>
          )}

          {create.isError && (
            <Notice tone="danger" title="Not generated">
              {errorMessage(create.error)}
            </Notice>
          )}
          {done && (
            <Notice tone="success" title="Narration requested" action={<Button label="Open history" compact variant="outline" onPress={() => router.navigate("/history")} />}>
              {done}
            </Notice>
          )}
          {chars > 0 && problems.length > 0 && <Body style={{ color: c.warning, fontSize: 13, marginBottom: 10 }}>{problems[0]}</Body>}

          <Button
            label="Generate Burmese narration"
            icon="sparkles"
            variant="accent"
            loading={create.isPending}
            disabled={!!blocker || problems.length > 0}
            onPress={submit}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Stepper({ icon, label, onPress, disabled }: { icon: "add" | "remove"; label: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.stepper, { borderColor: c.foreground, opacity: disabled ? 0.3 : 1 }]}
    >
      <Ionicons name={icon} size={18} color={c.foreground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  editor: { borderWidth: 1, borderRadius: 10, marginBottom: 14 },
  input: { minHeight: 220, padding: 16, fontFamily: Fonts.my, fontSize: 17, lineHeight: 32 },
  editorFoot: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12 },
  reserve: { flexDirection: "row", alignItems: "center", gap: 14, borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 14, marginBottom: 10 },
  reserveValue: { fontFamily: Fonts.bold, fontSize: 26, letterSpacing: -0.8 },
  stepper: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
});
