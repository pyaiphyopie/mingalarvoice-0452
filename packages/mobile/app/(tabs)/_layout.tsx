import { Platform } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "../../hooks/use-colors";
import { Fonts } from "../../constants/theme";
import { AudioProvider } from "../../components/audio";
import { SelectionProvider } from "../../components/selection";
import { StoreProvider } from "../../components/store";

type Icon = keyof typeof Ionicons.glyphMap;
const tabs: { name: string; title: string; icon: Icon; active: Icon }[] = [
  { name: "index", title: "Studio", icon: "mic-outline", active: "mic" },
  { name: "voices", title: "Voices", icon: "people-outline", active: "people" },
  { name: "history", title: "History", icon: "time-outline", active: "time" },
  { name: "credits", title: "Credits", icon: "wallet-outline", active: "wallet" },
  { name: "account", title: "Account", icon: "person-circle-outline", active: "person-circle" },
];

export default function TabLayout() {
  const colors = useColors();

  return (
    <SelectionProvider>
      <AudioProvider>
        <StoreProvider>
          <Tabs
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: colors.foreground,
              tabBarInactiveTintColor: colors.mutedForeground,
              // Poppins has tall ascenders; an explicit line height keeps labels inside the bar.
              tabBarLabelStyle: { fontFamily: Fonts.semibold, fontSize: 11, lineHeight: 16, flexShrink: 0 },
              tabBarStyle: {
                backgroundColor: colors.background,
                borderTopColor: colors.border,
                // The web preview has no home-indicator inset, so give the bar its own bottom room.
                ...(Platform.OS === "web" ? { height: 70, paddingBottom: 10, paddingTop: 6 } : null),
              },
            }}
          >
            {tabs.map((t) => (
              <Tabs.Screen
                key={t.name}
                name={t.name}
                options={{
                  title: t.title,
                  tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? t.active : t.icon} size={size} color={typeof color === "number" || color == null ? undefined : color} />,
                }}
              />
            ))}
          </Tabs>
        </StoreProvider>
      </AudioProvider>
    </SelectionProvider>
  );
}
