/**
 * Production Web Push Implementation using Web Crypto API & RFC 8291
 * Compliant with RFC 8291, RFC 8292 (VAPID)
 * Runs natively in Cloudflare Workers / Pages Functions
 */

import { buildPushPayload } from '@block65/webcrypto-web-push';

export interface PushMessagePayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  silent?: boolean;
  data?: Record<string, any>;
}

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export async function sendWebPush(
  endpoint: string,
  keys: PushSubscriptionKeys,
  payload: PushMessagePayload,
  vapidKeys: VapidKeys
): Promise<{ success: boolean; status: number; isExpired: boolean; errorText?: string }> {
  try {
    const sub = {
      endpoint,
      keys: {
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
    };

    const vapid = {
      subject: vapidKeys.subject,
      publicKey: vapidKeys.publicKey,
      privateKey: vapidKeys.privateKey,
    };

    // Full RFC 8291 aes128gcm message encryption
    const messageJson = JSON.stringify(payload);
    const built = await buildPushPayload(
      {
        data: messageJson,
        options: {
          ttl: 86400,
          urgency: payload.silent ? 'low' : 'high',
          // Omit HTTP Topic header on web.push.apple.com to prevent BadWebPushTopic 400 rejections;
          // Apple APNs uses 'apns-collapse-id' header instead for message collapsing.
          topic: (payload.tag && !endpoint.includes('push.apple.com')) ? payload.tag.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32) : undefined,
        },
      },
      sub,
      vapid
    );

    // Dispatch encrypted request directly to Push Service (APNs / FCM / Mozilla)
    const requestHeaders = { ...(built.headers as Record<string, string>) };
    
    // Apple APNs Web Push collapsing:
    // If endpoint is on web.push.apple.com, provide apns-collapse-id to collapse/replace
    // consecutive notifications under the same group on lock screen and Notification Center
    if (endpoint.includes('push.apple.com')) {
      if (payload.tag) {
        requestHeaders['apns-collapse-id'] = payload.tag.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      }
      if (payload.silent) {
        requestHeaders['apns-priority'] = '5';
      }
    }

    const response = await fetch(endpoint, {
      method: built.method,
      headers: requestHeaders,
      body: built.body,
    });

    const isExpired = response.status === 410 || response.status === 404;
    let errText = '';
    if (!response.ok && response.status !== 201) {
      errText = await response.text().catch(() => '');
      console.error(`Push Gateway responded with ${response.status}: ${errText}`);
    }

    return {
      success: response.ok || response.status === 201,
      status: response.status,
      isExpired,
      errorText: errText,
    };
  } catch (err: any) {
    console.error('sendWebPush exception:', err?.message || err);
    return {
      success: false,
      status: 500,
      isExpired: false,
      errorText: err?.message || String(err),
    };
  }
}
