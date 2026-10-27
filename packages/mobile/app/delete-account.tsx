import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Fonts } from "../constants/theme";
import { useColors } from "../hooks/use-colors";
import { useDeleteAccount, useMe } from "../queries/account";
import { useSession } from "../queries/session";
import { authClient, signOut, tokenStore } from "../lib/auth";
import { clearSharedAudio } from "../lib/share-audio";
import { Body, Button, GUTTER, Label, Loading, Notice, errorMessage } from "../components/ui";

const REAUTH_WINDOW_MS = 15 * 60_000;

export default function DeleteAccountScreen() {
  const c = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { signedIn } = useSession();
  const me = useMe();
  const remove = useDeleteAccount();
  const [confirm, setConfirm] = useState("");

  const close = () => (router.canGoBack() ? router.back() : router.replace("/account"));
  const signedInAt = me.data ? new Date(me.data.sessionCreatedAt).getTime() : 0;
  const recent = Date.now() - signedInAt < REAUTH_WINDOW_MS;

  const reauthenticate = async () => {
    await signOut();
    queryClient.clear();
    router.replace("/sign-in");
  };

  const destroy = () =>
    remove.mutate(
      { confirm: "DELETE" },
      {
        onSuccess: () => {
          tokenStore.clearToken();
          void clearSharedAudio();
          queryClient.clear();
          authClient.$store.notify("$sessionSignal");
          router.replace("/account");
        },
      },
    );

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
        <ScrollView contentContainerStyle={{ padding: GUTTER, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: "flex-end" }}>
            <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12}>
              <Ionicons name="close" size={28} color={c.foreground} />
            </Pressable>
          </View>
          <Text style={[styles.title, { color: c.foreground }]}>Delete account</Text>

          {!signedIn ? (
            <Notice title="You are signed out">Sign in to the account you want to delete.</Notice>
          ) : me.isLoading ? (
            <Loading />
          ) : (
            <>
              <Label style={{ marginTop: 10 }}>This permanently removes</Label>
              <Body style={styles.item}>• Your sign-in, profile and every active session</Body>
              <Body style={styles.item}>• All generated narrations and their audio files</Body>
              <Body style={styles.item}>• Favorites and the scripts stored in your history</Body>
              <Body style={styles.item}>• Every remaining credit, including App Store credits. They cannot be restored or refunded by us.</Body>
              <Label style={{ marginTop: 14 }}>What we keep</Label>
              <Body muted style={styles.item}>
                Payment and credit ledger records without your name or email, as required for accounting. App Store refunds are requested from Apple.
              </Body>

              {remove.isError && <Notice tone="danger" title="Account not deleted">{errorMessage(remove.error)}</Notice>}

              {!recent ? (
                <Notice
                  tone="warning"
                  title="Sign in again first"
                  action={<Button label="Sign in again" compact variant="outline" onPress={reauthenticate} />}
                >
                  For your security, deletion is available for 15 minutes after a fresh sign-in.
                </Notice>
              ) : (
                <>
                  <Label style={{ marginTop: 18, marginBottom: 8 }}>Type DELETE to confirm</Label>
                  <TextInput
                    value={confirm}
                    onChangeText={setConfirm}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    accessibilityLabel="Type DELETE to confirm"
                    placeholder="DELETE"
                    placeholderTextColor={c.mutedForeground}
                    style={[styles.input, { borderColor: c.destructive, color: c.foreground, backgroundColor: c.card }]}
                  />
                  <Button
                    label="Permanently delete"
                    variant="danger"
                    loading={remove.isPending}
                    disabled={confirm !== "DELETE"}
                    onPress={destroy}
                  />
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: Fonts.bold, fontSize: 34, letterSpacing: -1.2, textTransform: "uppercase", marginBottom: 8 },
  item: { fontSize: 14, marginTop: 6 },
  input: { borderWidth: 1.5, borderRadius: 10, minHeight: 52, paddingHorizontal: 16, fontFamily: Fonts.semibold, fontSize: 18, letterSpacing: 2, marginBottom: 14 },
});
