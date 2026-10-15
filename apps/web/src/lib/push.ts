import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function registerPushServiceWorker() {
  return navigator.serviceWorker.register('/sw.js');
}

export async function ensurePushSubscription(
  registration?: ServiceWorkerRegistration,
): Promise<'subscribed' | 'denied' | 'unavailable' | 'needs-permission'> {
  if (!pushSupported()) return 'unavailable';

  const permission = Notification.permission;
  if (permission === 'denied') return 'denied';
  if (permission === 'default') return 'needs-permission';

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return 'unavailable';

  const token = getToken();
  if (!token) return 'unavailable';

  const reg = registration ?? (await registerPushServiceWorker());
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return 'unavailable';
  }

  await api.subscribePush(token, {
    endpoint: json.endpoint,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
  });
  return 'subscribed';
}

export async function requestAndSubscribePush(): Promise<
  'subscribed' | 'denied' | 'unavailable'
> {
  if (!pushSupported()) return 'unavailable';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const result = await ensurePushSubscription();
  return result === 'subscribed' ? 'subscribed' : 'unavailable';
}

export async function syncAppBadgeFromUnread() {
  if (typeof navigator === 'undefined') return;
  const token = getToken();
  if (!token) return;

  try {
    const data = await api.chatUnreadCount(token);
    const count = data.chat ?? 0;
    if ('setAppBadge' in navigator) {
      if (count > 0) {
        await navigator.setAppBadge(count);
      } else if ('clearAppBadge' in navigator) {
        await navigator.clearAppBadge();
      }
    }
  } catch {
    // best-effort
  }
}

export async function clearAppBadge() {
  if (typeof navigator === 'undefined') return;
  if ('clearAppBadge' in navigator) {
    try {
      await navigator.clearAppBadge();
    } catch {
      // ignore
    }
  }
}
