import { Platform } from "react-native";

/**
 * App color tokens. Recolor these to brand the app — every screen and component
 * reads from here via `useColors()` (see `hooks/use-colors.ts`), so changing a
 * value here updates the whole app in both light and dark mode.
 *
 * The token names mirror the web app's design tokens (`packages/web/src/web/styles.css`)
 * so the two platforms share one vocabulary: `background`, `foreground`, `card`,
 * `primary`, `muted`, `border`, etc. Values are plain hex/rgba strings — React
 * Native's StyleSheet does not support CSS color functions like `oklch()`.
 */
export const Colors = {
  light: {
    background: "#FAF9F6",
    foreground: "#101010",
    card: "#FFFFFF",
    cardForeground: "#101010",
    primary: "#101010",
    primaryForeground: "#FAF9F6",
    secondary: "#E9E7FF",
    secondaryForeground: "#101010",
    muted: "#F0EFEA",
    mutedForeground: "#6B6A63",
    accent: "#B3AFF8",
    accentForeground: "#101010",
    border: "#DEDDD6",
    destructive: "#C2261F",
    success: "#1F7A45",
    warning: "#9A5B00",
  },
  dark: {
    background: "#101010",
    foreground: "#FAF9F6",
    card: "#1A1A1A",
    cardForeground: "#FAF9F6",
    primary: "#FAF9F6",
    primaryForeground: "#101010",
    secondary: "#24233A",
    secondaryForeground: "#FAF9F6",
    muted: "#222222",
    mutedForeground: "#A9A8A1",
    accent: "#B3AFF8",
    accentForeground: "#101010",
    border: "#2E2E2E",
    destructive: "#FF6B5E",
    success: "#5BD38D",
    warning: "#F2B248",
  },
} as const;

export type ColorScheme = keyof typeof Colors;
export type ThemeColors = (typeof Colors)[ColorScheme];

/** Families loaded in app/_layout.tsx with useFonts (expo-font). */
export const Fonts = {
  regular: "Poppins_400Regular",
  semibold: "Poppins_600SemiBold",
  bold: "Poppins_700Bold",
  my: "NotoSansMyanmar_400Regular",
  myBold: "NotoSansMyanmar_700Bold",
  mono: Platform.select({ ios: "Menlo", web: "'SF Mono', ui-monospace, monospace", default: "monospace" }),
};
