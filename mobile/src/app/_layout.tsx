import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { applyStoredTheme, usePalette } from "@/components/theme";

SplashScreen.preventAutoHideAsync();
// Before the first frame, so a Light choice never starts out dark
applyStoredTheme();

// One screen: the list, its calendar and its Progress view swap in place, as
// they do on the web.
export default function RootLayout() {
  const palette = usePalette();
  const scheme = useColorScheme();

  // Everything the first frame needs is read synchronously, so there's
  // nothing to wait for
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.surface }}>
      <SafeAreaProvider>
        <StatusBar style={scheme === "light" ? "dark" : "light"} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.surface },
          }}
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
