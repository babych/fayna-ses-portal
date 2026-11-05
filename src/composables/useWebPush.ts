/**
 * Web Push Client Composable
 * Handles permission requests, service worker registration, and D1 subscription synchronization
 */

import { ref, onMounted } from 'vue';

const VAPID_CONFIG_URL = '/api/push/config';
const SUBSCRIBE_URL = '/api/push/subscribe';
const UNSUBSCRIBE_URL = '/api/push/unsubscribe';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function useWebPush() {
  const isSupported = ref(false);
  const isSubscribed = ref(false);
  const currentScope = ref<string>('all');
  const loading = ref(false);
  const error = ref<string | null>(null);

  const checkSupport = () => {
    return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  };

  const syncSubscriptionState = async () => {
    if (!checkSupport()) {
      isSupported.value = false;
      return;
    }
    isSupported.value = true;

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      isSubscribed.value = !!sub;

      const savedScope = localStorage.getItem('fayna_push_scope');
      if (savedScope) {
        currentScope.value = savedScope;
      }
    } catch (e: any) {
      error.value = e.message;
    }
  };

  const subscribe = async (scope: string = 'all') => {
    loading.value = true;
    error.value = null;

    try {
      if (!checkSupport()) {
        throw new Error('Push notifications are not supported by this browser');
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error('Notification permission was denied');
      }

      // Fetch public VAPID key
      const configRes = await fetch(VAPID_CONFIG_URL);
      if (!configRes.ok) throw new Error('Failed to load Push configuration');
      const { publicKey } = await configRes.json();

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();

      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      // Sync with D1 Database via Edge Function
      const syncRes = await fetch(SUBSCRIBE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          scope,
        }),
      });

      if (!syncRes.ok) {
        const errJson = await syncRes.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to save subscription in database');
      }

      isSubscribed.value = true;
      currentScope.value = scope;
      localStorage.setItem('fayna_push_scope', scope);
      return true;
    } catch (e: any) {
      error.value = e.message;
      return false;
    } finally {
      loading.value = false;
    }
  };

  const unsubscribe = async () => {
    loading.value = true;
    error.value = null;

    try {
      if (!checkSupport()) return true;
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        await fetch(UNSUBSCRIBE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});

        await sub.unsubscribe();
      }

      isSubscribed.value = false;
      localStorage.removeItem('fayna_push_scope');
      return true;
    } catch (e: any) {
      error.value = e.message;
      return false;
    } finally {
      loading.value = false;
    }
  };

  onMounted(() => {
    syncSubscriptionState();
  });

  return {
    isSupported,
    isSubscribed,
    currentScope,
    loading,
    error,
    subscribe,
    unsubscribe,
  };
}
