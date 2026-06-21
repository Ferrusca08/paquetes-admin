import '../lib/amplify'; // configure Amplify before anything else

import { useEffect, useRef, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Hub } from 'aws-amplify/utils';
import {
  AuthContext,
  AuthUser,
  loadCurrentUser,
  appSignOut,
} from '../lib/hooks/useAuth';

export default function RootLayout() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();
  const navigationReady = useRef(false);

  const refreshUser = async () => {
    const u = await loadCurrentUser();
    setUser(u);
  };

  const signOut = async () => {
    await appSignOut();
    setUser(null);
  };

  // Load user on mount
  useEffect(() => {
    loadCurrentUser()
      .then(setUser)
      .finally(() => setIsLoading(false));
  }, []);

  // Listen to Amplify auth events (sign-in / sign-out from other screens)
  useEffect(() => {
    const unsubscribe = Hub.listen('auth', async ({ payload }) => {
      if (payload.event === 'signedIn') {
        const u = await loadCurrentUser();
        setUser(u);
      } else if (payload.event === 'signedOut') {
        setUser(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Auth-based navigation guard
  useEffect(() => {
    if (isLoading) return;
    navigationReady.current = true;

    const inAuth = segments[0] === '(auth)';
    const inGuard = segments[0] === '(guard)';
    const inResident = segments[0] === '(resident)';

    if (!user) {
      if (!inAuth) router.replace('/(auth)/login');
      return;
    }

    if (inAuth) {
      if (user.role === 'GUARD' || user.role === 'ADMIN') {
        router.replace('/(guard)/');
      } else {
        router.replace('/(resident)/');
      }
      return;
    }

    // Redirect if in wrong role's section
    if (user.role === 'RESIDENT' && !inResident) {
      router.replace('/(resident)/');
    } else if ((user.role === 'GUARD' || user.role === 'ADMIN') && !inGuard) {
      router.replace('/(guard)/');
    }
  }, [user, isLoading, segments]);

  return (
    <AuthContext.Provider value={{ user, isLoading, signOut, refreshUser }}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <StatusBar style="auto" />
          <Slot />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </AuthContext.Provider>
  );
}
