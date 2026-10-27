import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Purchase } from "expo-iap";
import { loadStoreKit, storeKitSupported } from "../lib/storekit";
import { useAppleConfig, useRedeem } from "../queries/apple";
import { useSession } from "../queries/session";

export type StorePack = { productId: string; credits: number; displayPrice: string; title: string };
export type StoreStatus = "signed-out" | "loading" | "disabled" | "unsupported" | "connecting" | "ready" | "error";
type Message = { tone: "success" | "warning" | "danger"; text: string } | null;

type StoreState = {
  status: StoreStatus;
  /** Server allowlist (credit amounts only; never prices). */
  allowlist: { productId: string; credits: number }[];
  /** StoreKit products with Apple-localized prices. Empty until StoreKit answers. */
  packs: StorePack[];
  buying: string | null;
  message: Message;
  clearMessage: () => void;
  buy: (productId: string) => Promise<void>;
};

const Ctx = createContext<StoreState | null>(null);

// StoreKit connect/disconnect calls are serialized so a quick sign-out → sign-in cannot let a
// stale endConnection() close the connection the new session just opened.
let lifecycle: Promise<unknown> = Promise.resolve();
const serial = <T,>(task: () => Promise<T>): Promise<T> => {
  const run = lifecycle.then(task, task);
  lifecycle = run.catch(() => undefined);
  return run;
};

/**
 * Owns the StoreKit connection while signed in. Credits are granted only by the server after it
 * verifies Apple's signed transaction; the transaction is finished only after that grant, so an
 * interrupted purchase is redelivered by StoreKit on next launch instead of being lost.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const { signedIn } = useSession();
  const config = useAppleConfig();
  const redeem = useRedeem();
  const redeemRef = useRef(redeem.mutateAsync);
  redeemRef.current = redeem.mutateAsync;
  const [connection, setConnection] = useState<"idle" | "connecting" | "ready" | "error">("idle");
  const [packs, setPacks] = useState<StorePack[]>([]);
  const [buying, setBuying] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const inflight = useRef(new Set<string>());

  const enabled = !!config.data?.enabled;
  const allowlist = config.data?.products ?? [];
  const skus = allowlist.map((p) => p.productId).join(",");
  const active = signedIn && enabled && storeKitSupported;

  useEffect(() => {
    if (!active || !skus) return;
    let cancelled = false;
    const subscriptions: { remove: () => void }[] = [];
    const credits = new Map(allowlist.map((p) => [p.productId, p.credits]));

    (async () => {
      setConnection("connecting");
      try {
        const iap = await loadStoreKit();
        await serial(() => iap.initConnection());
        if (cancelled) return;

        const settle = async (purchase: Purchase) => {
          if (purchase.purchaseState === "pending") {
            setBuying(null);
            setMessage({ tone: "warning", text: "Your purchase is waiting for approval. Credits are added after Apple completes it." });
            return;
          }
          const signedTransaction = purchase.purchaseToken;
          // On iOS `id` is the StoreKit transaction ID and `purchaseToken` its signed JWS.
          const txId = purchase.id;
          if (!signedTransaction || inflight.current.has(txId)) return;
          inflight.current.add(txId);
          try {
            const result = await redeemRef.current({ signedTransaction });
            await iap.finishTransaction({ purchase, isConsumable: true });
            setMessage({
              tone: "success",
              text: result.duplicate
                ? "This purchase was already added to your App Store credits."
                : `${result.credits.toLocaleString()} App Store credits were added.`,
            });
          } catch (e) {
            // Not finished: StoreKit keeps the transaction and redelivers it, so nothing is lost.
            setMessage({
              tone: "danger",
              text: `${(e as Error)?.message || "Credits could not be confirmed."} The App Store keeps this purchase open and it is checked again the next time you open the app while signed in to the account that bought it. Contact support if this persists.`,
            });
          } finally {
            inflight.current.delete(txId);
            setBuying(null);
          }
        };

        subscriptions.push(iap.purchaseUpdatedListener((p) => void settle(p)));
        subscriptions.push(
          iap.purchaseErrorListener((error) => {
            setBuying(null);
            if (iap.isUserCancelledError(error)) return;
            setMessage({ tone: "danger", text: error.message || "The App Store could not complete this purchase. You were not charged by this app." });
          }),
        );

        const products = await iap.fetchProducts({ skus: skus.split(","), type: "in-app" });
        if (cancelled) return;
        const list = ((products ?? []) as { id: string; displayPrice: string; title: string; platform: string }[])
          .filter((p) => credits.has(p.id))
          .map((p) => ({ productId: p.id, credits: credits.get(p.id)!, displayPrice: p.displayPrice, title: p.title }))
          .sort((a, b) => a.credits - b.credits);
        setPacks(list);
        setConnection("ready");
        // Surface any transaction that finished on Apple's side but was never granted here.
        await iap.getAvailablePurchases({ alsoPublishToEventListenerIOS: true }).catch(() => undefined);
      } catch {
        if (!cancelled) setConnection("error");
      }
    })();

    return () => {
      cancelled = true;
      subscriptions.forEach((s) => s.remove());
      void serial(async () => (await loadStoreKit()).endConnection()).catch(() => undefined);
      setConnection("idle");
      setPacks([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, skus]);

  const buy = useCallback(
    async (productId: string) => {
      const token = config.data?.appAccountToken;
      if (connection !== "ready" || !token) return;
      setMessage(null);
      setBuying(productId);
      try {
        const iap = await loadStoreKit();
        // appAccountToken binds the Apple transaction to this account; the server rejects mismatches.
        await iap.requestPurchase({ request: { apple: { sku: productId, appAccountToken: token } }, type: "in-app" });
      } catch (e) {
        setBuying(null);
        setMessage({ tone: "danger", text: (e as Error)?.message || "The App Store could not start this purchase." });
      }
    },
    [config.data?.appAccountToken, connection],
  );

  let status: StoreStatus;
  if (!signedIn) status = "signed-out";
  else if (config.isLoading) status = "loading";
  else if (config.isError) status = "error";
  else if (!enabled) status = "disabled";
  else if (!storeKitSupported) status = "unsupported";
  else status = connection === "ready" ? "ready" : connection === "error" ? "error" : "connecting";

  return (
    <Ctx.Provider value={{ status, allowlist, packs, buying, message, clearMessage: () => setMessage(null), buy }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
