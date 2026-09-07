import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: '#F9FAFB' },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
    </SafeAreaProvider>
  );
}
