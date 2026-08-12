import { Stack, useRouter, useSegments } from 'expo-router';
import { GluestackUIProvider, Box, Text, Center, Spinner } from '@gluestack-ui/themed';
import { config } from '../config';
import { AppProvider } from '@/context/app';
import { AuthProvider, useAuth } from '@/context/auth';
import { AutocompleteDropdownContextProvider } from 'react-native-autocomplete-dropdown';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from 'react-error-boundary';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import 'react-native-reanimated';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

function ErrorFallback({ error }: { error: Error }) {
  return (
    <Box style={styles.container}>
      <Text style={styles.errorText}>Something went wrong:</Text>
      <Text style={styles.errorMessage}>{error.message}</Text>
    </Box>
  );
}

function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/');
    }
  }, [isAuthenticated, isLoading, segments, router]);

  if (isLoading) {
    return (
      <Center flex={1}>
        <Spinner size='large' />
      </Center>
    );
  }

  return (
    <AutocompleteDropdownContextProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name='(auth)' />
        <Stack.Screen name='(tabs)' />
        <Stack.Screen name='tours' />
        <Stack.Screen name='activities' />
      </Stack>
    </AutocompleteDropdownContextProvider>
  );
}

export default function RootLayout() {
  useEffect(() => {
    // Hide splash screen after mounting (or wait for resources if needed)
    SplashScreen.hideAsync();
  }, []);

  return (
    <GluestackUIProvider config={config}>
      <SafeAreaProvider>
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <AuthProvider>
              <AppProvider>
                <RootNavigator />
              </AppProvider>
            </AuthProvider>
          </GestureHandlerRootView>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GluestackUIProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  errorText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ff0000',
  },
  errorMessage: {
    marginTop: 8,
    color: '#ff0000',
  },
});
