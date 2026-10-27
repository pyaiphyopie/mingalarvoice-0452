import { createAuthClient } from "better-auth/react";
import { managedAuthExpoClient } from "@runablehq/managed-auth/native";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { apiBase } from "./config";
import { clearSharedAudio } from "./share-audio";

// Platform-managed identity: never edit `expo.extra` or `expo.scheme` in app.json.
const extra = Constants.expoConfig?.extra ?? {};
const isWeb = Platform.OS === "web";
const KEY = "runable.managed-auth.token";
let cached: string | undefined;

/** One bearer-token source shared by managed sign-in, email sign-in and the oRPC client. */
export const tokenStore = {
  getToken(): string {
    if (isWeb) return typeof localStorage === "undefined" ? "" : (localStorage.getItem(KEY) ?? "");
    return (cached ??= SecureStore.getItem(KEY) ?? "");
  },
  setToken(token: string): void {
    if (isWeb) {
      localStorage.setItem(KEY, token);
      return;
    }
    cached = token;
    SecureStore.setItem(KEY, token);
  },
  clearToken(): void {
    if (isWeb) {
      localStorage.removeItem(KEY);
      return;
    }
    cached = "";
    SecureStore.setItem(KEY, "");
  },
};

// Native requests carry the app's own deep-link scheme as their origin; the server trusts exactly it.
const nativeOrigin = `${Constants.expoConfig?.scheme ?? "mobile"}://`;

export const authClient = createAuthClient({
  baseURL: apiBase,
  basePath: "/api/auth",
  fetchOptions: {
    ...(isWeb ? { credentials: "omit" as const } : { headers: { "expo-origin": nativeOrigin } }),
    auth: { type: "Bearer", token: () => tokenStore.getToken() },
  },
  plugins: [
    managedAuthExpoClient({
      applicationId: extra.applicationId,
      issuer: extra.runableAuthIssuer,
      storage: tokenStore,
    }),
  ],
});

/** Pass as onSuccess to email sign-in/sign-up so the bearer token lands in the shared store. */
export function captureToken(ctx: { response: Response }) {
  const token = ctx.response.headers.get("set-auth-token");
  if (token) tokenStore.setToken(token);
}

export async function signOut() {
  try {
    await authClient.signOut();
  } catch {
    // Offline or already-expired session: the local token is still removed below.
  } finally {
    tokenStore.clearToken();
    await clearSharedAudio();
  }
}
