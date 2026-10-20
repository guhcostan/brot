import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { useFonts } from 'expo-font';
import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState, type ReactElement } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BrotProvider, useBrot } from '../src/core/BrotProvider';
import { applyLocalePreference, loadLocalePreference } from '../src/i18n/preference';
import { useLocale } from '../src/i18n/useLocale';
import { secureStorage } from '../src/session/secureStorage';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';

void SplashScreen.preventAutoHideAsync();

function Navigator({ fontsReady }: { fontsReady: boolean }): ReactElement | null {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const { phase } = useBrot();
  const [localeReady, setLocaleReady] = useState(false);
  useLocale();
  const ready = fontsReady && localeReady && phase !== 'loading';

  useEffect(() => {
    void loadLocalePreference(secureStorage)
      .then(applyLocalePreference)
      .finally(() => setLocaleReady(true));
  }, []);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.color.bg);
  }, [theme]);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <>
      <StatusBar style={theme.name === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.color.bg },
          animation: reduced ? 'fade' : 'default',
        }}
      >
        <Stack.Protected guard={phase === 'paired'}>
          <Stack.Screen name="index" />
          <Stack.Screen name="thread/[botId]" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="room/[threadId]" />
          <Stack.Screen name="tasks" />
          <Stack.Screen name="computer/[botId]" options={{ presentation: 'fullScreenModal', animation: reduced ? 'fade' : 'slide_from_bottom' }} />
          <Stack.Screen
            name="approval/[id]"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              sheetGrabberVisible: true,
              sheetCornerRadius: theme.radius.xl,
              contentStyle: { backgroundColor: theme.color.surface },
            }}
          />
        </Stack.Protected>
        <Stack.Protected guard={phase === 'unpaired'}>
          <Stack.Screen name="pair" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout(): ReactElement {
  const [fontsReady, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  return (
    <SafeAreaProvider>
      <ThemeProvider preference="system">
        <BrotProvider>
          <Navigator fontsReady={fontsReady || fontError !== null} />
        </BrotProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
