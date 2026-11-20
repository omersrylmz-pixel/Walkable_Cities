import NetInfo from '@react-native-community/netinfo';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { flushQueue } from '@/lib/queue';

export default function RootLayout() {
  useEffect(() => {
    // Açılışta ve bağlantı geldiğinde bekleyen ihbarları gönder.
    void flushQueue();

    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        void flushQueue();
      }
    });

    return unsubscribe;
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0f172a' },
          headerTintColor: '#f8fafc',
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: '#0b1220' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Yaya İhlal Bildir' }} />
        <Stack.Screen name="queue" options={{ title: 'Gönderim Kuyruğu' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
