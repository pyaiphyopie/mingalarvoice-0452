import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Fonts } from "../../constants/theme";
import { useColors } from "../../hooks/use-colors";
import { useSession } from "../../queries/session";
import { useWallet } from "../../queries/studio";
import { useApplePurchases } from "../../queries/apple";
import { useStore } from "../../components/store";
import { Body, Button, Card, Label, Loading, My, Notice, Screen, Title, errorMessage } from "../../components/ui";

const minutes = (credits: number) => Math.floor(credits / 60).toLocaleString();

export default function CreditsScreen() {
  const c = useColors();
  const router = useRouter();
  const { signedIn, isPending } = useSession();
  const wallet = useWallet();
  const purchases = useApplePurchases();
  const store = useStore();
  const w = wallet.data;
  const planActive = w?.subscription?.status === "active" && (w.subscription.periodEnd ?? 0) > Date.now();

  return (
    <Screen>
      <Title my="ခရက်ဒစ်များ">Credits</Title>

      {!isPending && !signedIn && (
        <Notice title="Sign in to see your credits" action={<Button label="Sign in" compact onPress={() => router.push("/sign-in")} />}>
          Credits belong to your account.
        </Notice>
      )}

      {signedIn && (
        <>
          {wallet.isLoading && <Loading />}
          {wallet.isError && (
            <Notice tone="danger" title="Balance could not load" action={<Button label="Retry" compact variant="outline" onPress={() => wallet.refetch()} />}>
              {errorMessage(wallet.error)}
            </Notice>
          )}
          {w && (
            <Card tint="ink" style={{ marginBottom: 12 }}>
              <Label style={{ color: c.accent }}>App Store credits</Label>
              <Text style={[styles.big, { color: c.primaryForeground }]}>{w.apple.available.toLocaleString()}</Text>
              <Body style={{ color: c.primaryForeground, opacity: 0.75, fontSize: 13 }}>
                Never expire · about {minutes(w.apple.available)} min of audio
                {w.apple.reserved ? ` · ${w.apple.reserved.toLocaleString()} held for narrations in progress` : ""}
              </Body>
            </Card>
          )}
          {w && (w.available > 0 || w.reserved > 0 || w.subscription) && (
            <Card style={{ marginBottom: 12 }}>
              <Label>Plan credits</Label>
              <Text style={[styles.mid, { color: c.foreground }]}>{w.available.toLocaleString()}</Text>
              <Body muted style={{ fontSize: 13 }}>
                {planActive
                  ? `Usable until ${new Date(w.subscription!.periodEnd!).toLocaleDateString()}. Used before App Store credits.`
                  : "Not usable right now — the access period for these credits has ended."}
              </Body>
            </Card>
          )}
        </>
      )}

      <View style={{ marginTop: 18, marginBottom: 10 }}>
        <Label>Credit packs</Label>
        <Body muted style={{ fontSize: 13, marginTop: 4 }}>
          One credit ≈ one second of generated audio. You reserve a maximum per narration and only measured seconds are charged.
        </Body>
      </View>

      {store.message && (
        <Notice
          tone={store.message.tone}
          title={store.message.tone === "success" ? "Purchase complete" : store.message.tone === "warning" ? "Purchase pending" : "Purchase not completed"}
          action={<Button label="Dismiss" compact variant="ghost" onPress={store.clearMessage} />}
        >
          {store.message.text}
        </Notice>
      )}

      {store.status === "disabled" && (
        <Notice title="App Store purchases are not available yet">
          Credit packs will appear here with App Store pricing once in-app purchases are set up.
        </Notice>
      )}
      {store.status === "unsupported" && (
        <Notice title="Purchases need the iOS app">This preview cannot reach the App Store. Install the iOS app to buy credit packs.</Notice>
      )}
      {store.status === "error" && (
        <Notice tone="danger" title="The App Store is not responding">
          No purchase was made. Close and reopen Credits to try again.
        </Notice>
      )}
      {(store.status === "loading" || store.status === "connecting") && <Loading />}

      {store.status === "ready" && store.packs.length === 0 && (
        <Notice tone="warning" title="No packs are on sale">
          The App Store returned no products for this app right now.
        </Notice>
      )}
      {store.status === "ready" &&
        store.packs.map((p, i) => (
          <Card key={p.productId} tint={i === 1 ? "accent" : "lavender"} style={styles.pack}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.mid, { color: c.accentForeground }]}>{p.credits.toLocaleString()} credits</Text>
              <Body style={{ color: c.accentForeground, fontSize: 13 }}>About {minutes(p.credits)} minutes · never expire</Body>
            </View>
            <Button
              label={p.displayPrice}
              accessibilityLabel={`Buy ${p.credits} credits for ${p.displayPrice}`}
              loading={store.buying === p.productId}
              disabled={!!store.buying && store.buying !== p.productId}
              onPress={() => store.buy(p.productId)}
            />
          </Card>
        ))}

      {/* Without StoreKit there is no price to show, so packs are listed by size only. */}
      {(store.status === "disabled" || store.status === "unsupported") &&
        store.allowlist.map((p) => (
          <Card key={p.productId} style={[styles.pack, { opacity: 0.6 }]}>
            <Text style={[styles.mid, { color: c.foreground }]}>{p.credits.toLocaleString()} credits</Text>
            <Label>Unavailable</Label>
          </Card>
        ))}

      {signedIn && (purchases.data?.length ?? 0) > 0 && (
        <View style={{ marginTop: 22 }}>
          <Label>App Store purchases</Label>
          {purchases.data!.map((p) => (
            <View key={p.transactionId} style={[styles.purchase, { borderColor: c.border }]}>
              <Body style={{ fontSize: 14 }}>
                {p.credits.toLocaleString()} credits · {p.status === "granted" ? "Added" : p.status === "revoked" ? "Refunded by Apple" : p.status}
              </Body>
              <Label>{new Date(p.grantedAt).toLocaleDateString()}</Label>
            </View>
          ))}
        </View>
      )}

      <My style={{ color: c.mutedForeground, fontSize: 13, marginTop: 22 }}>
        ဝယ်ယူမှုများကို App Store မှ ကိုင်တွယ်ပြီး ခရက်ဒစ်များ သက်တမ်းမကုန်ပါ။
      </My>
    </Screen>
  );
}

const styles = StyleSheet.create({
  big: { fontFamily: Fonts.bold, fontSize: 44, letterSpacing: -1.5, lineHeight: 52 },
  mid: { fontFamily: Fonts.bold, fontSize: 22, letterSpacing: -0.6 },
  pack: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  purchase: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, paddingVertical: 10 },
});
