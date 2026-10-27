import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Fonts } from "../constants/theme";
import { useColors } from "../hooks/use-colors";
import { authClient, captureToken } from "../lib/auth";
import { Body, Button, Chip, GUTTER, Label, My, Notice } from "../components/ui";

type Mode = "sign-in" | "sign-up";
const DISMISSED = new Set(["AUTH_SESSION_DISMISSED", "POPUP_CLOSED"]);

export default function SignInScreen() {
  const c = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"apple" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = () => {
    // Drop anything cached while signed out (or by a previous account) before the new session's data loads.
    void queryClient.resetQueries();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const apple = async () => {
    setError(null);
    setBusy("apple");
    try {
      const result = await authClient.managedAuth.signIn({ provider: "apple" });
      if (result.error) {
        if (!DISMISSED.has(result.error.code)) setError(result.error.message || "Sign in with Apple did not complete.");
      } else finish();
    } catch (e) {
      setError((e as Error)?.message || "Sign in with Apple did not complete.");
    } finally {
      setBusy(null);
    }
  };

  const submitEmail = async () => {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (password.length < 10) return setError("Passwords are at least 10 characters.");
    if (mode === "sign-up" && !name.trim()) return setError("Enter your name.");
    setBusy("email");
    const options = { onSuccess: captureToken };
    try {
      const result =
        mode === "sign-in"
          ? await authClient.signIn.email({ email: email.trim(), password }, options)
          : await authClient.signUp.email({ email: email.trim(), password, name: name.trim() }, options);
      if (result.error) setError(result.error.message || "That did not work. Check your details and try again.");
      else finish();
    } catch (e) {
      setError((e as Error)?.message || "Could not reach Mingalar Voice. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const field = [styles.input, { borderColor: c.border, color: c.foreground, backgroundColor: c.card }];

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
        <ScrollView contentContainerStyle={{ padding: GUTTER, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={styles.top}>
            <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12}>
              <Ionicons name="close" size={28} color={c.foreground} />
            </Pressable>
          </View>
          <Text style={[styles.title, { color: c.foreground }]}>{mode === "sign-in" ? "Welcome back" : "Create account"}</Text>
          <My style={{ color: c.mutedForeground, fontSize: 15, marginBottom: 24 }}>မင်္ဂလာအသံသို့ ဝင်ရောက်ပါ</My>

          {error && <Notice tone="danger" title="Not signed in">{error}</Notice>}

          <Pressable
            onPress={apple}
            disabled={!!busy}
            accessibilityRole="button"
            accessibilityLabel="Sign in with Apple"
            style={({ pressed }) => [styles.apple, { backgroundColor: c.primary, opacity: busy ? 0.5 : pressed ? 0.85 : 1 }]}
          >
            <Ionicons name="logo-apple" size={20} color={c.primaryForeground} />
            <Text style={[styles.appleText, { color: c.primaryForeground }]}>{busy === "apple" ? "Opening Apple…" : "Sign in with Apple"}</Text>
          </Pressable>

          <View style={styles.divider}>
            <View style={[styles.rule, { backgroundColor: c.border }]} />
            <Label>or with email</Label>
            <View style={[styles.rule, { backgroundColor: c.border }]} />
          </View>

          <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
            <Chip label="SIGN IN" active={mode === "sign-in"} onPress={() => setMode("sign-in")} />
            <Chip label="CREATE ACCOUNT" active={mode === "sign-up"} onPress={() => setMode("sign-up")} />
          </View>

          {mode === "sign-up" && (
            <TextInput value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={c.mutedForeground} autoComplete="name" textContentType="name" accessibilityLabel="Name" style={field} />
          )}
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={c.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            accessibilityLabel="Email"
            style={field}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder={mode === "sign-up" ? "Password (10+ characters)" : "Password"}
            placeholderTextColor={c.mutedForeground}
            secureTextEntry
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            textContentType={mode === "sign-up" ? "newPassword" : "password"}
            accessibilityLabel="Password"
            onSubmitEditing={submitEmail}
            style={field}
          />
          <Button label={mode === "sign-in" ? "Sign in" : "Create account"} variant="accent" loading={busy === "email"} disabled={!!busy} onPress={submitEmail} />

          <Body muted style={{ fontSize: 12, marginTop: 18, textAlign: "center" }}>
            By continuing you agree to the Terms of use and Privacy policy, available from the Account tab.
          </Body>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: "flex-end", marginBottom: 8 },
  title: { fontFamily: Fonts.bold, fontSize: 34, letterSpacing: -1.2, textTransform: "uppercase", lineHeight: 38 },
  apple: { minHeight: 52, borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  appleText: { fontFamily: Fonts.semibold, fontSize: 16 },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 22 },
  rule: { flex: 1, height: 1 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, minHeight: 52, fontFamily: Fonts.regular, fontSize: 16, marginBottom: 12 },
});
