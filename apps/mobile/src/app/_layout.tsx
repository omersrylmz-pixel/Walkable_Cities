import NetInfo from '@react-native-community/netinfo';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { flushQueue } from '@/lib/queue';

export default function RootLayout() {
  useEffect(() => {
    // Açılışta ve bağlantı geldiğinde bekleyen ihbarları gönder.
    void flushQueue();

    const unsubscribeNet = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        void flushQueue();
      }
    });

    // Uygulama arka plandan döndüğünde de dene; kullanıcı kuyruğu elle
    // göndermek zorunda kalmasın.
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void flushQueue();
      }
    });

    return () => {
      unsubscribeNet();
      appState.remove();
    };
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
