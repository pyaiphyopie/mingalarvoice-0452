import Constants from "expo-constants";

const raw: string = Constants.expoConfig?.extra?.apiUrl ?? process.env.EXPO_PUBLIC_API_URL ?? "";
/** Server origin without a trailing slash (app.json's apiUrl ends with one). */
export const apiBase = raw.replace(/\/+$/, "");
/** Resolves server-relative paths such as /audio/... against the API host. */
export const absoluteUrl = (path: string) => (/^https?:/.test(path) ? path : `${apiBase}${path}`);
export const SUPPORT_EMAIL = "pyaiphyopie@gmail.com";
