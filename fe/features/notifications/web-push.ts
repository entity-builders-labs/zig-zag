import {
  registerWebPushSubscription,
  unregisterWebPushSubscription,
} from '../../api/devices';

const SERVICE_WORKER_PATH = '/zigzag-push-sw.js';

function decodeVapidKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

function toPayload(subscription: PushSubscription) {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('The browser returned an incomplete PushSubscription');
  }
  return {
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  };
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function getRegistration() {
  return navigator.serviceWorker.register(SERVICE_WORKER_PATH);
}

export async function syncExistingWebPushSubscription(): Promise<boolean> {
  if (!isWebPushSupported() || Notification.permission !== 'granted') {
    return false;
  }
  const registration = await getRegistration();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  await registerWebPushSubscription(toPayload(subscription));
  return true;
}

export async function enableWebPushNotifications(): Promise<boolean> {
  if (!isWebPushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const publicKey = process.env.EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
  if (!publicKey) throw new Error('Missing EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY');
  const registration = await getRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(publicKey),
    });
  }
  await registerWebPushSubscription(toPayload(subscription));
  return true;
}

export async function disableWebPushNotifications(): Promise<void> {
  if (!isWebPushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await unregisterWebPushSubscription(subscription.endpoint);
  } finally {
    await subscription.unsubscribe();
  }
}
