import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Fonts } from "../../constants/theme";
import { useColors } from "../../hooks/use-colors";
import { useSession } from "../../queries/session";
import { useMe } from "../../queries/account";
import { signOut } from "../../lib/auth";
import { SUPPORT_EMAIL, apiBase } from "../../lib/config";
import { Body, Button, Card, Label, Loading, Screen, Title } from "../../components/ui";

const links = [
  { label: "Support", path: "/support", icon: "help-buoy-outline" },
  { label: "Privacy policy", path: "/privacy", icon: "shield-checkmark-outline" },
  { label: "Terms of use", path: "/terms", icon: "document-text-outline" },
] as const;

export default function AccountScreen() {
  const c = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { signedIn, isPending, data } = useSession();
  const me = useMe();

  return (
    <Screen>
      <Title my="အကောင့်">Account</Title>

      {isPending ? (
        <Loading />
      ) : signedIn ? (
        <Card style={{ marginBottom: 16 }}>
          <Label>Signed in as</Label>
          <Text style={[styles.name, { color: c.foreground }]} numberOfLines={1}>
            {me.data?.name || data?.user.name || "Mingalar Voice user"}
          </Text>
          <Body muted style={{ fontSize: 14 }}>{me.data?.email ?? data?.user.email}</Body>
          <Button
            label="Sign out"
            variant="outline"
            compact
            style={{ marginTop: 14, alignSelf: "flex-start" }}
            onPress={async () => {
              await signOut();
              queryClient.clear();
            }}
          />
        </Card>
      ) : (
        <Card tint="lavender" style={{ marginBottom: 16 }}>
          <Text style={[styles.name, { color: c.accentForeground }]}>Not signed in</Text>
          <Body style={{ color: c.accentForeground, fontSize: 14, marginBottom: 14 }}>
            Sign in to generate narration, keep favorites and use your credits.
          </Body>
          <Button label="Sign in" onPress={() => router.push("/sign-in")} />
        </Card>
      )}

      <Label style={{ marginBottom: 6, marginTop: 6 }}>Help & policies</Label>
      {links.map((l) => (
        <Pressable
          key={l.path}
          accessibilityRole="link"
          onPress={() => WebBrowser.openBrowserAsync(`${apiBase}${l.path}`)}
          style={[styles.link, { borderColor: c.border }]}
        >
          <Ionicons name={l.icon} size={20} color={c.foreground} />
          <Text style={[styles.linkText, { color: c.foreground }]}>{l.label}</Text>
          <Ionicons name="open-outline" size={16} color={c.mutedForeground} />
        </Pressable>
      ))}
      <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} style={[styles.link, { borderColor: c.border }]}>
        <Ionicons name="mail-outline" size={20} color={c.foreground} />
        <Text style={[styles.linkText, { color: c.foreground }]}>{SUPPORT_EMAIL}</Text>
      </Pressable>

      {signedIn && (
        <View style={{ marginTop: 30 }}>
          <Label style={{ color: c.destructive }}>Danger zone</Label>
          <Body muted style={{ fontSize: 13, marginVertical: 8 }}>
            Permanently delete your account, narrations, favorites and remaining credits.
          </Body>
          <Button label="Delete account" variant="danger" icon="trash-outline" onPress={() => router.push("/delete-account")} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: Fonts.bold, fontSize: 22, letterSpacing: -0.5, marginTop: 4 },
  link: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 15, borderBottomWidth: 1 },
  linkText: { flex: 1, fontFamily: Fonts.semibold, fontSize: 15 },
});
