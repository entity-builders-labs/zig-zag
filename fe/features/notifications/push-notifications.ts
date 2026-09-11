import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { registerDeviceToken, unregisterDeviceToken } from '../../api/devices';
import {
  disableWebPushNotifications,
  enableWebPushNotifications,
  syncExistingWebPushSubscription,
} from './web-push';

const PUSH_TOKEN_STORAGE_KEY = 'registered_expo_push_token';
const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

let notificationsModule: typeof import('expo-notifications') | null | undefined = undefined;

function getNotificationsModule(): typeof import('expo-notifications') | null {
  if (notificationsModule !== undefined) return notificationsModule;
  if (!isNative) {
    notificationsModule = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    notificationsModule = require('expo-notifications');
    return notificationsModule;
  } catch {
    notificationsModule = null;
    return null;
  }
}

async function readStoredToken(): Promise<string | null> {
  return AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
}

async function storeToken(token: string): Promise<void> {
  await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
}

async function clearStoredToken(): Promise<void> {
  await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
}

async function getExpoPushToken(
  requestPermission: boolean,
): Promise<string | null> {
  const notif = getNotificationsModule();
  if (!isNative || !notif) return null;
  try {
    const { status: existingStatus } = await notif.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted' && requestPermission) {
      finalStatus = (await notif.requestPermissionsAsync()).status;
    }
    if (finalStatus !== 'granted') return null;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
    const token = (
      await notif.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      )
    ).data;
    await storeToken(token);
    return token;
  } catch {
    return null;
  }
}

/** Re-registers an already-authorized channel without prompting the user. */
export async function syncPushNotifications(): Promise<boolean> {
  if (Platform.OS === 'web') return syncExistingWebPushSubscription();
  const token = (await readStoredToken()) || (await getExpoPushToken(false));
  if (!token) return false;
  await registerDeviceToken(token);
  return true;
}

/** Must be called from a user gesture because it can request permission. */
export async function enablePushNotifications(): Promise<boolean> {
  if (Platform.OS === 'web') return enableWebPushNotifications();
  const token = (await readStoredToken()) || (await getExpoPushToken(true));
  if (!token) return false;
  await registerDeviceToken(token);
  return true;
}

export async function disablePushNotifications(): Promise<void> {
  if (Platform.OS === 'web') {
    await disableWebPushNotifications();
    return;
  }

  const token = await readStoredToken();
  try {
    if (token) await unregisterDeviceToken(token);
  } finally {
    await clearStoredToken();
  }
}
