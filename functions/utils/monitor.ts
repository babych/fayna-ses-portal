import { sendWebPush } from '../utils/webpush';

interface Env {
  DB: D1Database;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  ADMIN_API_KEY?: string;
}

const UPSTREAM_DATA_BASE = 'https://data-ses.funs.net.ua/s';

const STATIONS = [
  { id: 'cc5a340c80f5ce04158291f4aac365a6', name: 'ОСББ №2, Буд. 1, Під. 5' },
  { id: '366ae83e5947dbd6b6d30372f916a71f', name: 'ОСББ №4, Буд. 9, Під. 8' },
  { id: '91d435460f4c38741aa0ee07808a5960', name: 'ОСББ №6, Буд. 18, Під. 7' },
  { id: 'e64791f0a8f89a5400db11c0f8c82c57', name: 'ОСББ №6, Буд. 18, Під. 8 (Ліфт)' },
  { id: 'ac15fb3d463174465df3bedcb30be9cc', name: 'ОСББ №7, Буд. 24, Під. 2' },
];

interface StationState {
  id: string;
  name: string;
  isBlackout: boolean;
  gridPower: number;
  buildingPower: number;
  recentSamples?: Array<{
    t: number;
    soc: number | null;
    batt: number | null;
    grid: number | null;
    load: number | null;
    pv: number | null;
  }>;
}

export async function checkAndDispatchOutages(env: Env): Promise<{
  checked: number;
  blackoutCount: number;
  notified: boolean;
  message?: string;
}> {
  if (!env.DB) {
    throw new Error('Database D1 is not bound');
  }

  const now = Math.floor(Date.now() / 1000);

  // 1. Fetch current live telemetry for all stations in parallel
  const stationResults = await Promise.allSettled(
    STATIONS.map(async (st) => {
      const res = await fetch(`${UPSTREAM_DATA_BASE}/${st.id}/today.json`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as any;
      const sampleCount = data.t?.length || 0;
      if (sampleCount === 0) throw new Error('No samples in feed');
      const lastIndex = sampleCount - 1;
      const lastTs = Number(data.updated || data.t?.[lastIndex] || 0);
      if (now - lastTs > 1800) {
        throw new Error('Telemetry is stale (>30m old)');
      }
      const grid = Number(data.grid?.[lastIndex] ?? 0);
      const load = Number(data.load?.[lastIndex] ?? 0);
      const batt = Number(data.batt?.[lastIndex] ?? 0);
      // Real blackout: absolute grid near zero (ruling out negative regenerative elevator braking)
      // and battery actively discharging to power load or building load active without grid
      const isBlackout = Math.abs(grid) <= 20 && (batt > 50 || load > 50);

      // Extract recent telemetry samples (up to last 12 samples = past 1 hour) to archive in D1
      const recentSamples: StationState['recentSamples'] = [];
      const sliceStart = Math.max(0, sampleCount - 12);
      for (let i = sliceStart; i < sampleCount; i++) {
        const tVal = Number(data.t?.[i]);
        if (tVal && !isNaN(tVal)) {
          recentSamples.push({
            t: tVal,
            soc: data.soc?.[i] !== null && data.soc?.[i] !== undefined ? Number(data.soc[i]) : null,
            batt: data.batt?.[i] !== null && data.batt?.[i] !== undefined ? Number(data.batt[i]) : null,
            grid: data.grid?.[i] !== null && data.grid?.[i] !== undefined ? Number(data.grid[i]) : null,
            load: data.load?.[i] !== null && data.load?.[i] !== undefined ? Number(data.load[i]) : null,
            pv: data.pv?.[i] !== null && data.pv?.[i] !== undefined ? Number(data.pv[i]) : null,
          });
        }
      }

      return {
        id: st.id,
        name: st.name,
        isBlackout,
        gridPower: grid,
        buildingPower: load,
        recentSamples,
      } as StationState;
    })
  );

  const activeStations: StationState[] = [];
  for (const r of stationResults) {
    if (r.status === 'fulfilled') {
      activeStations.push(r.value);
    }
  }

  if (activeStations.length === 0) {
    return { checked: 0, blackoutCount: 0, notified: false, message: 'All upstream stations unreachable' };
  }

  const blackoutStations = activeStations.filter((s) => s.isBlackout);
  const currentBlackoutCount = blackoutStations.length;
  const isComplexBlackout = currentBlackoutCount > 0;

  // 1b. Self-Hosted Telemetry Archiving into D1
  // Collect all new telemetry samples from active stations and insert via atomic batch
  const telemetryStatements: D1PreparedStatement[] = [];
  for (const st of activeStations) {
    if (st.recentSamples && st.recentSamples.length > 0) {
      for (const sample of st.recentSamples) {
        telemetryStatements.push(
          env.DB.prepare(
            INSERT OR IGNORE INTO station_telemetry 
             (station_id, timestamp, soc, batt_w, grid_w, load_w, pv_w) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
          ).bind(
            st.id,
            sample.t,
            sample.soc,
            sample.batt,
            sample.grid,
            sample.load,
            sample.pv
          )
        );
      }
    }
  }

  if (telemetryStatements.length > 0) {
    try {
      // Chunk batch operations to stay safely within D1 batch boundaries (max 100 statements per batch)
      const D1_BATCH_LIMIT = 50;
      for (let i = 0; i < telemetryStatements.length; i += D1_BATCH_LIMIT) {
        const slice = telemetryStatements.slice(i, i + D1_BATCH_LIMIT);
        await env.DB.batch(slice);
      }
    } catch (ingestErr: any) {
      // Non-blocking error logging: never fail outage PNS dispatch if telemetry table insert fails
      console.error('[Telemetry Archive Error]:', ingestErr?.message || ingestErr);
    }
  }

  // 2. Load previous state from D1 (table: grid_states)
  const prevRows = await env.DB.prepare(
    `SELECT target_id, is_blackout, last_changed_at, last_notified_at FROM grid_states`
  ).all<{ target_id: string; is_blackout: number; last_changed_at: number; last_notified_at: number }>();

  const prevStatesMap = new Map<string, { is_blackout: number; last_changed_at: number; last_notified_at: number }>();
  for (const row of prevRows.results || []) {
    prevStatesMap.set(row.target_id, row);
  }

  const prevComplex = prevStatesMap.get('complex');
  const prevBlackoutCount = prevComplex ? prevComplex.is_blackout : 0;
  const lastNotifiedAt = prevComplex ? prevComplex.last_notified_at : 0;

  // Track which specific stations changed their blackout state
  const changedStationIds = new Set<string>();
  for (const st of activeStations) {
    const prevState = prevStatesMap.get(st.id);
    const prevIsBlackout = prevState ? Boolean(prevState.is_blackout) : false;
    if (!prevState || prevIsBlackout !== st.isBlackout) {
      changedStationIds.add(st.id);
    }
  }

  // Has the outage state changed? (e.g. 0 -> 1, 2 -> 1, 1 -> 0)
  const stateChanged = prevComplex === undefined || prevBlackoutCount !== currentBlackoutCount;

  // If complex count didn't change AND no individual station changed state, we are stable -> exit early
  if (!stateChanged && changedStationIds.size === 0) {
    return {
      checked: activeStations.length,
      blackoutCount: currentBlackoutCount,
      notified: false,
      message: `State stable (${currentBlackoutCount}/${activeStations.length} in blackout)`,
    };
  }

  // Anti-spam cooldown: if a notification was sent less than 90 seconds ago,
  // skip sending notifications and do not update last_notified_at
  // (so the state change is picked up on the next cron run after cooldown expires)
  const timeSinceLastNotification = now - lastNotifiedAt;
  if (timeSinceLastNotification < 90) {
    return {
      checked: activeStations.length,
      blackoutCount: currentBlackoutCount,
      notified: false,
      message: `Cooldown active (${timeSinceLastNotification}s < 90s), skipping notification`,
    };
  }

  // 3. Craft notification payload
  let title = '⚡ Файна Таун: Енергопостачання';
  let body = '';

  if (currentBlackoutCount === 0) {
    title = '🟢 Світло є у всіх будинках!';
    body = `Міську електромережу відновлено на всіх ${activeStations.length} станціях ЖК Файна Таун.`;
  } else if (currentBlackoutCount === STATIONS.length) {
    title = '🔴 Повний блекаут комплексу';
    body = `Всі ${STATIONS.length} станцій перейшли на живлення від батарейних систем.`;
  } else {
    // Partial outage
    const affectedNames = blackoutStations.map((s) => s.name).join(', ');
    title = `🟡 Частковий блекаут (${currentBlackoutCount} з ${activeStations.length})`;
    body = `Без міського живлення: ${affectedNames}. Решта будинків зі світлом.`;
  }

  // 4. Query subscribers with scope support
  const subs = await env.DB.prepare(
    `SELECT id, endpoint, p256dh, auth, scope FROM push_subscriptions WHERE is_active = 1`
  ).all<{ id: string; endpoint: string; p256dh: string; auth: string; scope?: string }>();

  const recipientList = subs.results || [];
  let successCount = 0;
  let failedCount = 0;
  const expiredIds: string[] = [];

  const vapidPublic = env.VAPID_PUBLIC_KEY;
  const vapidPrivate = env.VAPID_PRIVATE_KEY;
  const vapidSub = env.VAPID_SUBJECT || 'mailto:admin@fayna-town.kyiv.ua';

  if (!vapidPublic || !vapidPrivate) {
    console.error('VAPID keys not configured in environment, skipping notification dispatch');
    return {
      checked: activeStations.length,
      blackoutCount: currentBlackoutCount,
      notified: false,
      message: 'VAPID keys not configured',
    };
  }

  // Filter and prepare messages for recipients
  interface PushTask {
    sub: { id: string; endpoint: string; p256dh: string; auth: string; scope?: string };
    title: string;
    body: string;
    url: string;
  }

  const tasksToDispatch: PushTask[] = [];

  for (const sub of recipientList) {
    const scope = (sub.scope || 'all').toLowerCase().trim();
    let recipientTitle = title;
    let recipientBody = body;

    if (scope !== 'all') {
      const myStation = activeStations.find((s) => s.id === scope);
      // Skip if station is offline/unreachable or its state did not change
      if (!myStation || !changedStationIds.has(scope)) {
        continue;
      }

      if (myStation.isBlackout) {
        recipientTitle = `🔴 ${myStation.name}: Блекаут`;
        recipientBody = `Міську електромережу вимкнено. Станція перейшла на живлення від батарейних систем.`;
      } else {
        recipientTitle = `🟢 ${myStation.name}: Світло є!`;
        recipientBody = `Міську електромережу підключено. Станція працює у штатному режимі.`;
      }
    }

    tasksToDispatch.push({
      sub,
      title: recipientTitle,
      body: recipientBody,
      url: scope !== 'all' ? `/?station=${scope}` : '/',
    });
  }

  // Dispatch in parallel batches of 15
  const CHUNK_SIZE = 15;
  for (let i = 0; i < tasksToDispatch.length; i += CHUNK_SIZE) {
    const chunk = tasksToDispatch.slice(i, i + CHUNK_SIZE);
    const results = await Promise.allSettled(
      chunk.map((item) =>
        sendWebPush(
          item.sub.endpoint,
          { p256dh: item.sub.p256dh, auth: item.sub.auth },
          {
            title: item.title,
            body: item.body,
            icon: '/icon-192.png',
            tag: 'fayna-grid-status',
            data: { url: item.url },
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
      const item = chunk[index];
      if (res.status === 'fulfilled') {
        const pushRes = res.value;
        if (pushRes.success) {
          successCount++;
        } else {
          failedCount++;
          if (pushRes.isExpired) {
            expiredIds.push(item.sub.id);
          }
        }
      } else {
        failedCount++;
      }
    });
  }

  // 5. Combine all expiredIds deactivations, grid_states upserts, and push_logs insert
  // into a single env.DB.batch call
  const batchStatements: D1PreparedStatement[] = [];

  // Deactivate expired tokens
  if (expiredIds.length > 0) {
    for (const id of expiredIds) {
      batchStatements.push(
        env.DB.prepare(`UPDATE push_subscriptions SET is_active = 0 WHERE id = ?`).bind(id)
      );
    }
  }

  // Update complex grid_state
  batchStatements.push(
    env.DB.prepare(
      `INSERT INTO grid_states (target_id, is_blackout, last_changed_at, last_notified_at)
       VALUES ('complex', ?1, ?2, ?3)
       ON CONFLICT(target_id) DO UPDATE SET
         is_blackout = ?1,
         last_changed_at = ?2,
         last_notified_at = ?3`
    ).bind(currentBlackoutCount, now, now)
  );

  // Update individual station grid_states
  for (const st of activeStations) {
    const isOffNum = st.isBlackout ? 1 : 0;
    const isChanged = changedStationIds.has(st.id);
    batchStatements.push(
      env.DB.prepare(
        `INSERT INTO grid_states (target_id, is_blackout, last_changed_at, last_notified_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(target_id) DO UPDATE SET
           is_blackout = ?2,
           last_changed_at = CASE WHEN ?5 = 1 THEN ?3 ELSE last_changed_at END,
           last_notified_at = CASE WHEN ?5 = 1 THEN ?4 ELSE last_notified_at END`
      ).bind(st.id, isOffNum, now, now, isChanged ? 1 : 0)
    );
  }

  // Insert audit log
  batchStatements.push(
    env.DB.prepare(
      `INSERT INTO push_logs (target_id, event_type, total_recipients, success_count, failed_count, created_at)
       VALUES ('complex', ?1, ?2, ?3, ?4, ?5)`
    ).bind(
      currentBlackoutCount > 0 ? 'blackout_state_change' : 'grid_restored',
      recipientList.length,
      successCount,
      failedCount,
      now
    )
  );

  // Prune audit logs older than 30 days
  const pruneCutoff = now - 30 * 86400;
  batchStatements.push(
    env.DB.prepare(`DELETE FROM push_logs WHERE created_at < ?`).bind(pruneCutoff)
  );

  // Execute all D1 queries in a single atomic batch
  await env.DB.batch(batchStatements);

  return {
    checked: activeStations.length,
    blackoutCount: currentBlackoutCount,
    notified: true,
    message: `Dispatched to ${successCount} subscribers. ${body}`,
  };
}
