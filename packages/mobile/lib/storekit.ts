import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";

/**
 * StoreKit needs the ExpoIap native module, which exists only in an iOS development or
 * App Store build — never in Expo Go or the web preview. Everything else must not load it.
 */
export const storeKitSupported =
  Platform.OS === "ios" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

type ExpoIap = typeof import("expo-iap");
let loaded: Promise<ExpoIap> | null = null;

export function loadStoreKit(): Promise<ExpoIap> {
  if (!storeKitSupported) return Promise.reject(new Error("App Store purchases need the iOS app."));
  return (loaded ??= import("expo-iap"));
}
