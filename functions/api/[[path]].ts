/**
 * Cloudflare Pages Functions - Full API Router & Observability Engine
 * Features:
 * - CORS proxy for data-ses.funs.net.ua
 * - Cloudflare Edge Caching (Cache API) with HIT / MISS telemetry
 * - Diagnostics & Health endpoint: GET /api/health
 * - Push Subscription Management (D1 Database): POST /api/push/subscribe, POST /api/push/unsubscribe
 * - Push Public Config: GET /api/push/config
 * - Admin Metrics & Stats (Secured with 256-bit ADMIN_API_KEY): GET /api/admin/metrics
 * - Grid Status Check & Push Trigger: POST /api/push/trigger
 */

import { sendWebPush } from '../utils/webpush';
import { checkAndDispatchOutages } from '../utils/monitor';

interface Env {
  STATIONS_KV?: KVNamespace;
  DB?: D1Database;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  ADMIN_API_KEY?: string;
}

const UPSTREAM_BASE = 'https://data-ses.funs.net.ua/s';

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.ADMIN_API_KEY) {
    return false;
  }
  const headerKey = request.headers.get('X-Admin-Key');
  const queryKey = new URL(request.url).searchParams.get('key');
  return (headerKey === env.ADMIN_API_KEY) || (queryKey === env.ADMIN_API_KEY);
}

async function sha256(str: string): Promise<string> {
  const enc = new TextEncoder();
  const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, params, env } = context;
  const path = (params.path as string[])?.join('/') || '';
  const startTime = Date.now();

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, User-Agent, X-Admin-Key',
    'Access-Control-Expose-Headers': 'Server-Timing, X-Proxy-Latency, X-Edge-Cache, CF-Ray',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // -------------------------------------------------------------
  // 1. Web Push Public Config: GET /api/push/config
  // -------------------------------------------------------------
  if (path === 'push/config' && request.method === 'GET') {
    const publicKey = env.VAPID_PUBLIC_KEY;
    if (!publicKey) {
      return new Response(JSON.stringify({ error: 'VAPID_PUBLIC_KEY is not configured in environment' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ publicKey }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    });
  }

  // -------------------------------------------------------------
  // 2. Subscribe to Web Push: POST /api/push/subscribe
  // -------------------------------------------------------------
  if (path === 'push/subscribe' && request.method === 'POST') {
    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'Database D1 is not bound' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = (await request.json()) as {
        subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
        scope?: string;
      };

      if (!body?.subscription?.endpoint || !body?.subscription?.keys?.p256dh || !body?.subscription?.keys?.auth) {
        return new Response(JSON.stringify({ error: 'Invalid PushSubscription payload' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const endpoint = body.subscription.endpoint.trim();
      const p256dh = body.subscription.keys.p256dh.trim();
      const auth = body.subscription.keys.auth.trim();
      const scope = (body.scope || 'all').trim().toLowerCase();

      // SSRF Protection: Validate Push Service URL
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(endpoint);
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid PushSubscription endpoint URL' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (parsedUrl.protocol !== 'https:') {
        return new Response(JSON.stringify({ error: 'PushSubscription endpoint must use HTTPS' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const ALLOWED_PUSH_DOMAINS = [
        '.push.apple.com',
        '.googleapis.com',
        '.google.com',
        '.mozilla.com',
        '.windows.com',
        '.notify.windows.com',
      ];

      const hostname = parsedUrl.hostname.toLowerCase();
      const isAllowedDomain = ALLOWED_PUSH_DOMAINS.some(
        (domain) => hostname === domain.slice(1) || hostname.endsWith(domain)
      );

      if (!isAllowedDomain) {
        return new Response(JSON.stringify({ error: 'Forbidden PushSubscription domain' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const id = await sha256(endpoint);
      const now = Math.floor(Date.now() / 1000);

      // Safe Upsert using D1 with unique endpoint
      await env.DB.prepare(
        `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, scope, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
         ON CONFLICT(endpoint) DO UPDATE SET
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           scope = excluded.scope,
           is_active = 1,
           updated_at = excluded.updated_at`
      )
        .bind(id, endpoint, p256dh, auth, scope, now)
        .run();

      return new Response(JSON.stringify({ success: true, id, scope }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: 'Subscription failed', details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // -------------------------------------------------------------
  // 3. Unsubscribe from Web Push: POST /api/push/unsubscribe
  // -------------------------------------------------------------
  if (path === 'push/unsubscribe' && request.method === 'POST') {
    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'Database D1 is not bound' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = (await request.json()) as { endpoint: string };
      if (!body?.endpoint) {
        return new Response(JSON.stringify({ error: 'Endpoint is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Mark inactive (avoids table re-indexing overhead)
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        `UPDATE push_subscriptions SET is_active = 0, updated_at = ? WHERE endpoint = ?`
      )
        .bind(now, body.endpoint.trim())
        .run();

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: 'Unsubscribe failed', details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // -------------------------------------------------------------
  // 4. Admin Metrics Endpoint: GET /api/admin/metrics
  // Protected with 256-bit ADMIN_API_KEY
  // -------------------------------------------------------------
  if (path === 'admin/metrics' && request.method === 'GET') {
    if (!isAuthorized(request, env)) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid Admin Key' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'Database D1 is not bound' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      // 1. Total & Active subscribers breakdown by scope (Index covered: idx_subs_active_scope)
      const scopeCounts = await env.DB.prepare(
        `SELECT scope, COUNT(*) as count 
         FROM push_subscriptions 
         WHERE is_active = 1 
         GROUP BY scope`
      ).all<{ scope: string; count: number }>();

      const totalActiveRes = await env.DB.prepare(
        `SELECT COUNT(*) as total FROM push_subscriptions WHERE is_active = 1`
      ).first<{ total: number }>();

      const totalHistoricRes = await env.DB.prepare(
        `SELECT COUNT(*) as total FROM push_subscriptions`
      ).first<{ total: number }>();

      // 2. Recent push audit log
      const recentLogs = await env.DB.prepare(
        `SELECT target_id, event_type, total_recipients, success_count, failed_count, created_at
         FROM push_logs
         ORDER BY created_at DESC
         LIMIT 10`
      ).all();

      return new Response(
        JSON.stringify(
          {
            status: 'ok',
            subscribers: {
              activeTotal: totalActiveRes?.total || 0,
              allTimeTotal: totalHistoricRes?.total || 0,
              byScope: scopeCounts.results || [],
            },
            recentPushLogs: recentLogs.results || [],
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        }
      );
    } catch (err: any) {
      return new Response(JSON.stringify({ error: 'Failed to retrieve metrics', details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // -------------------------------------------------------------
  // 5. Trigger / Check Push Notifications: POST /api/push/trigger
  // Can be called by Cron Worker or Admin
  // -------------------------------------------------------------
  if (path === 'push/trigger' && request.method === 'POST') {
    if (!isAuthorized(request, env)) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid Admin Key' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'Database D1 is not bound' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = (await request.json().catch(() => ({}))) as {
        scope?: string;
        title?: string;
        body?: string;
        tag?: string;
      };

      const targetScope = body.scope || 'all';
      const title = body.title || '⚡ Файна Таун: Статус живлення';
      const message = body.body || 'Оновлення стану електропостачання комплексу.';
      const tag = body.tag || 'faynagridstatus';

      const vapidPublic = env.VAPID_PUBLIC_KEY;
      const vapidPrivate = env.VAPID_PRIVATE_KEY;
      const vapidSub = env.VAPID_SUBJECT || 'mailto:admin@fayna-town.kyiv.ua';

      if (!vapidPublic || !vapidPrivate) {
        return new Response(JSON.stringify({ error: 'VAPID keys are not configured in environment' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Query recipients using index (Index covered: idx_subs_active_scope)
      const query = targetScope === 'all'
        ? `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE is_active = 1`
        : `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE is_active = 1 AND (scope = ?1 OR scope = 'all')`;

      const subscribers = targetScope === 'all'
        ? await env.DB.prepare(query).all<{ id: string; endpoint: string; p256dh: string; auth: string }>()
        : await env.DB.prepare(query).bind(targetScope).all<{ id: string; endpoint: string; p256dh: string; auth: string }>();

      const recipientList = subscribers.results || [];
      let successCount = 0;
      let failedCount = 0;
      const expiredIds: string[] = [];
      const errors: string[] = [];

      // Dispatch push in chunks of 15 using Promise.allSettled
      const CHUNK_SIZE = 15;
      for (let i = 0; i < recipientList.length; i += CHUNK_SIZE) {
        const chunk = recipientList.slice(i, i + CHUNK_SIZE);
        const results = await Promise.allSettled(
          chunk.map((sub) =>
            sendWebPush(
              sub.endpoint,
              { p256dh: sub.p256dh, auth: sub.auth },
              {
                title,
                body: message,
                icon: '/icon-192.png',
                badge: '/favicon.svg',
                tag,
                data: { url: '/' },
              },
              {
                publicKey: vapidPublic,
                privateKey: vapidPrivate,
                subject: vapidSub,
              }
            )
          )
        );

        results.forEach((res, index) => {
          const sub = chunk[index];
          if (res.status === 'fulfilled') {
            const pushRes = res.value;
            if (pushRes.success) {
              successCount++;
            } else {
              failedCount++;
              errors.push(`Status: ${pushRes.status}, msg: ${(pushRes as any).errorText || 'unknown'}`);
              if (pushRes.isExpired) {
                expiredIds.push(sub.id);
              }
            }
          } else {
            failedCount++;
            errors.push(`Error: ${res.reason?.message || 'Dispatch rejected'}`);
          }
        });
      }

      // Automatically prune / deactivate expired subscriptions via D1 batch
      if (expiredIds.length > 0) {
        const batchDeactivate = expiredIds.map((id) =>
          env.DB!.prepare(`UPDATE push_subscriptions SET is_active = 0 WHERE id = ?`).bind(id)
        );
        await env.DB.batch(batchDeactivate);
      }

      // Log push execution and prune logs older than 30 days
      const now = Math.floor(Date.now() / 1000);
      const pruneCutoff = now - 30 * 86400;
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO push_logs (target_id, event_type, total_recipients, success_count, failed_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(targetScope, 'dispatch', recipientList.length, successCount, failedCount, now),
        env.DB.prepare(`DELETE FROM push_logs WHERE created_at < ?`).bind(pruneCutoff),
      ]);

      return new Response(
        JSON.stringify({
          success: true,
          total: recipientList.length,
          delivered: successCount,
          failed: failedCount,
          prunedExpired: expiredIds.length,
          errors,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } catch (err: any) {
      return new Response(JSON.stringify({ error: 'Push dispatch failed', details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // -------------------------------------------------------------
  // 6. Automated / Scheduled Outage Monitor: POST or GET /api/push/cron
  // Performs edge detection across all 5 stations, records in D1,
  // and dispatches Web Push if outage state has changed.
  // -------------------------------------------------------------
  if (path === 'push/cron') {
    if (!isAuthorized(request, env)) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid Admin Key' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      const result = await checkAndDispatchOutages(env as any);
      return new Response(JSON.stringify({ success: true, ...result }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: 'Outage monitor failed', details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // -------------------------------------------------------------
  // Diagnostics & Observability Endpoint: /api/health
  // -------------------------------------------------------------
  if (path === 'health') {
    const cf = (request as any).cf || {};
    const testStart = Date.now();
    let upstreamStatus = 'unknown';
    let upstreamLatency = 0;

    try {
      const probe = await fetch(`${UPSTREAM_BASE}/cc5a340c80f5ce04158291f4aac365a6/station.json`, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Cloudflare-Observability-Probe/1.0' },
      });
      upstreamLatency = Date.now() - testStart;
      upstreamStatus = probe.ok ? 'healthy' : `degraded (${probe.status})`;
    } catch (e: any) {
      upstreamStatus = `unreachable (${e.message})`;
      upstreamLatency = Date.now() - testStart;
    }

    const healthData = {
      status: 'ok',
      service: 'fayna-ses-edge-proxy',
      timestamp: new Date().toISOString(),
      database: {
        d1Configured: Boolean(env.DB),
      },
      edge: {
        colo: cf.colo || 'LOCAL',
        country: cf.country || 'UA',
        city: cf.city || 'Kyiv',
        ray: request.headers.get('cf-ray') || 'local-ray',
      },
      upstream: {
        endpoint: 'data-ses.funs.net.ua',
        status: upstreamStatus,
        latencyMs: upstreamLatency,
      },
      observability: {
        cacheTtlSeconds: 60,
        staleWhileRevalidateSeconds: 300,
      },
    };

    return new Response(JSON.stringify(healthData, null, 2), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Server-Timing': `edge;dur=${Date.now() - startTime}, upstream;dur=${upstreamLatency}`,
      },
    });
  }

  // -------------------------------------------------------------
  // -------------------------------------------------------------
  // Self-Hosted Historical Telemetry Endpoint:
  // GET /api/:stationId/d1-history?from=...&to=...
  // Serves reconstructed timeseries directly from our D1 replica
  // -------------------------------------------------------------
  const d1HistoryMatch = path.match(/^([0-9a-f]{32})\/d1-history$/i);
  if (d1HistoryMatch && request.method === 'GET') {
    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'Database D1 not bound' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stationId = d1HistoryMatch[1].toLowerCase();
    const url = new URL(request.url);
    const fromTs = Number(url.searchParams.get('from')) || (Math.floor(Date.now() / 1000) - 86400);
    const toTs = Number(url.searchParams.get('to')) || Math.floor(Date.now() / 1000);
    const limit = Math.min(Number(url.searchParams.get('limit')) || 2000, 10000);

    try {
      const rows = await env.DB.prepare(`
        SELECT timestamp, soc, batt_w, grid_w, load_w, pv_w 
         FROM station_telemetry 
         WHERE station_id = ?1 AND timestamp >= ?2 AND timestamp <= ?3 
         ORDER BY timestamp ASC 
         LIMIT ?4
      `).bind(stationId, fromTs, toTs, limit).all<{
        timestamp: number;
        soc: number | null;
        batt_w: number | null;
        grid_w: number | null;
        load_w: number | null;
        pv_w: number | null;
      }>();

      const results = rows.results || [];
      const payload = {
        stationId,
        from: fromTs,
        to: toTs,
        count: results.length,
        t: results.map((r) => r.timestamp),
        soc: results.map((r) => r.soc),
        batt: results.map((r) => r.batt_w),
        grid: results.map((r) => r.grid_w),
        load: results.map((r) => r.load_w),
        pv: results.map((r) => r.pv_w),
      };

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60, s-maxage=120',
          'Server-Timing': `edge;dur=${Date.now() - startTime}`,
        },
      });
    } catch (d1Err: any) {
      return new Response(JSON.stringify({ error: 'Failed to query D1 history', details: d1Err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // Standard Edge Telemetry & Historical Cache Proxy (GET only)
  // -------------------------------------------------------------
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  if (!path) {
    return new Response(JSON.stringify({ error: 'Endpoint path required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Strict Proxy Whitelist for upstream data files
  const PROXY_WHITELIST_REGEX = /^[0-9a-f]{32}\/(station|today|day\/\d{4}-\d{2}-\d{2}|month\/\d{4}-\d{2})\.json$/i;
  if (!PROXY_WHITELIST_REGEX.test(path)) {
    return new Response(JSON.stringify({ error: 'Invalid or forbidden upstream path' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const cache = (caches as any).default;
  const cacheKey = new Request(request.url, { method: 'GET' });

  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    const newHeaders = new Headers(cachedResponse.headers);
    newHeaders.set('X-Edge-Cache', 'HIT');
    newHeaders.set('X-Proxy-Latency', `${Date.now() - startTime}ms`);
    newHeaders.set('Access-Control-Allow-Origin', '*');
    newHeaders.set('Server-Timing', `edge;dur=${Date.now() - startTime}`);

    return new Response(cachedResponse.body, {
      status: cachedResponse.status,
      statusText: cachedResponse.statusText,
      headers: newHeaders,
    });
  }

  const upstreamUrl = `${UPSTREAM_BASE}/${path}`;
  const upstreamFetchStart = Date.now();

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FaynaSESPortal/1.0; CloudflareEdge)',
        Accept: 'application/json',
      },
    });

    const upstreamDuration = Date.now() - upstreamFetchStart;
    const totalDuration = Date.now() - startTime;

    if (!upstreamRes.ok) {
      return new Response(JSON.stringify({ error: 'Upstream returned error', status: upstreamRes.status }), {
        status: upstreamRes.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'X-Edge-Cache': 'BYPASS',
          'X-Proxy-Latency': `${totalDuration}ms`,
          'Server-Timing': `upstream;dur=${upstreamDuration}, total;dur=${totalDuration}`,
        },
      });
    }

    const data = await upstreamRes.text();

    const isHistoricalArchive = /\/day\/\d{4}-\d{2}-\d{2}\.json$/.test(path) || /\/month\/\d{4}-\d{2}\.json$/.test(path);
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date());
    const currentMonthStr = todayStr.slice(0, 7);
    const isPastPeriod = (path.includes('/day/') && !path.includes(todayStr)) ||
                         (path.includes('/month/') && !path.includes(currentMonthStr));

    const cacheControl = (isHistoricalArchive && isPastPeriod)
      ? 'public, max-age=2592000, s-maxage=31536000, immutable'
      : 'public, max-age=30, s-maxage=60, stale-while-revalidate=300';

    const responseToCache = new Response(data, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': cacheControl,
        'X-Edge-Cache': 'MISS',
        'X-Proxy-Latency': `${totalDuration}ms`,
        'Server-Timing': `upstream;dur=${upstreamDuration}, total;dur=${totalDuration}`,
      },
    });

    context.waitUntil(cache.put(cacheKey, responseToCache.clone()));

    return responseToCache;
  } catch (err: any) {
    const totalDuration = Date.now() - startTime;
    return new Response(JSON.stringify({ error: 'Failed to fetch upstream', message: err.message }), {
      status: 502,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'X-Edge-Cache': 'ERROR',
        'X-Proxy-Latency': `${totalDuration}ms`,
      },
    });
  }
};
