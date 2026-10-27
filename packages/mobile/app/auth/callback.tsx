import { Redirect } from "expo-router";

// Deep-link landing route for managed sign-in; the auth session itself completes the exchange.
export default function AuthCallback() {
  return <Redirect href="/" />;
}
