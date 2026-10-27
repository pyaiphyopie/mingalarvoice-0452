import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Fonts } from "../constants/theme";
import { useColors } from "../hooks/use-colors";

export const GUTTER = 20;

/** Tab screen shell: SafeAreaView (tab bar supplies the bottom inset) + optional scroll. */
export function Screen({ children, scroll = true, bottom = false }: { children: ReactNode; scroll?: boolean; bottom?: boolean }) {
  const c = useColors();
  const edges = bottom ? (["top", "left", "right", "bottom"] as const) : (["top", "left", "right"] as const);
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.background }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </SafeAreaView>
  );
}

export function Title({ children, my, right }: { children: string; my: string; right?: ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.titleRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: c.foreground }]} accessibilityRole="header">
          {children}
        </Text>
        <My style={{ color: c.mutedForeground, fontSize: 14 }}>{my}</My>
      </View>
      {right}
    </View>
  );
}

/** Burmese text — always Noto Sans Myanmar with generous line height so stacked diacritics never clip. */
export function My({ children, style, bold, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; bold?: boolean; numberOfLines?: number }) {
  const c = useColors();
  const size = (StyleSheet.flatten(style)?.fontSize as number | undefined) ?? 16;
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ color: c.foreground, fontFamily: bold ? Fonts.myBold : Fonts.my, fontSize: size, lineHeight: Math.round(size * 1.9) }, style]}
    >
      {children}
    </Text>
  );
}

export function Body({ children, style, muted, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; muted?: boolean; numberOfLines?: number }) {
  const c = useColors();
  return (
    <Text numberOfLines={numberOfLines} style={[{ color: muted ? c.mutedForeground : c.foreground, fontFamily: Fonts.regular, fontSize: 15, lineHeight: 22 }, style]}>
      {children}
    </Text>
  );
}

export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  return <Text style={[styles.label, { color: c.mutedForeground }, style]}>{children}</Text>;
}

type Variant = "ink" | "accent" | "outline" | "danger" | "ghost";

export function Button({
  label,
  onPress,
  variant = "ink",
  icon,
  disabled,
  loading,
  compact,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const c = useColors();
  const palette: Record<Variant, { bg: string; fg: string; border: string }> = {
    ink: { bg: c.primary, fg: c.primaryForeground, border: c.primary },
    accent: { bg: c.accent, fg: c.accentForeground, border: c.accent },
    outline: { bg: "transparent", fg: c.foreground, border: c.foreground },
    danger: { bg: c.destructive, fg: "#FFFFFF", border: c.destructive },
    ghost: { bg: "transparent", fg: c.foreground, border: "transparent" },
  };
  const p = palette[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        { backgroundColor: p.bg, borderColor: p.border, opacity: off ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={compact ? 16 : 18} color={p.fg} />}
          <Text style={[styles.buttonText, compact && { fontSize: 13 }, { color: p.fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Card({ children, style, tint }: { children: ReactNode; style?: StyleProp<ViewStyle>; tint?: "accent" | "ink" | "lavender" }) {
  const c = useColors();
  const bg = tint === "accent" ? c.accent : tint === "ink" ? c.primary : tint === "lavender" ? c.secondary : c.card;
  return <View style={[styles.card, { backgroundColor: bg, borderColor: tint ? bg : c.border }, style]}>{children}</View>;
}

type Tone = "info" | "warning" | "danger" | "success";

/** Explicit state banner: offline, paused, signed out, zero credits, disabled integrations. */
export function Notice({ tone = "info", title, children, action }: { tone?: Tone; title: string; children?: ReactNode; action?: ReactNode }) {
  const c = useColors();
  const color = { info: c.foreground, warning: c.warning, danger: c.destructive, success: c.success }[tone];
  const icon = { info: "information-circle", warning: "pause-circle", danger: "alert-circle", success: "checkmark-circle" }[tone] as keyof typeof Ionicons.glyphMap;
  return (
    <View accessibilityRole="alert" style={[styles.notice, { borderColor: c.border, backgroundColor: c.card, borderLeftColor: color }]}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        <Ionicons name={icon} size={18} color={color} style={{ marginTop: 2 }} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontFamily: Fonts.semibold, fontSize: 15, color: c.foreground }}>{title}</Text>
          {typeof children === "string" ? <Body muted style={{ fontSize: 14 }}>{children}</Body> : children}
        </View>
      </View>
      {action && <View style={{ marginTop: 12 }}>{action}</View>}
    </View>
  );
}

export function Chip({ label, active, onPress, color }: { label: string; active?: boolean; onPress?: () => void; color?: string }) {
  const c = useColors();
  const content = (
    <Text style={{ fontFamily: Fonts.semibold, fontSize: 12, color: active ? c.primaryForeground : (color ?? c.foreground), letterSpacing: 0.4 }}>{label}</Text>
  );
  const style = [styles.chip, { borderColor: color ?? c.border, backgroundColor: active ? c.primary : "transparent" }];
  if (!onPress) return <View style={style}>{content}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!active }} style={style}>
      {content}
    </Pressable>
  );
}

export function Loading() {
  const c = useColors();
  return (
    <View style={{ paddingVertical: 40, alignItems: "center" }}>
      <ActivityIndicator color={c.foreground} />
    </View>
  );
}

export const errorMessage = (e: unknown) =>
  (e as { message?: string } | null)?.message || "Something went wrong. Please try again.";

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "flex-end", paddingTop: 16, paddingBottom: 18, gap: 12 },
  title: { fontFamily: Fonts.bold, fontSize: 34, lineHeight: 38, letterSpacing: -1.2, textTransform: "uppercase" },
  label: { fontFamily: Fonts.semibold, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" },
  button: {
    minHeight: 50,
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  compact: { minHeight: 36, paddingHorizontal: 14 },
  buttonText: { fontFamily: Fonts.semibold, fontSize: 15 },
  card: { borderRadius: 10, borderWidth: 1, padding: 16 },
  notice: { borderWidth: 1, borderLeftWidth: 4, borderRadius: 10, padding: 14, marginBottom: 14 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, alignSelf: "flex-start" },
});
