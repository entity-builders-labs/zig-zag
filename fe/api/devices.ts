import axiosInstance from './config/axios';
import { Platform } from 'react-native';

export interface RegisterDevicePayload {
  expoPushToken: string;
  platform: 'ios' | 'android';
}

export async function registerDeviceToken(token: string) {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error('Expo push tokens can only be registered on native devices');
  }
  const platform = Platform.OS;
  const { data } = await axiosInstance.post('/notifications/devices', {
    expoPushToken: token,
    platform,
  });
  return data;
}

export async function unregisterDeviceToken(token: string) {
  const { data } = await axiosInstance.delete(`/notifications/devices/${encodeURIComponent(token)}`);
  return data;
}

export type WebPushSubscriptionPayload = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function registerWebPushSubscription(
  subscription: WebPushSubscriptionPayload,
) {
  const { data } = await axiosInstance.post(
    '/notifications/devices/web',
    subscription,
  );
  return data;
}

export async function unregisterWebPushSubscription(endpoint: string) {
  const { data } = await axiosInstance.delete('/notifications/devices/web', {
    data: { endpoint },
  });
  return data;
}
