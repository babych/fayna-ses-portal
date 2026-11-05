import type {
  BatteryState,
  ConnectionStatus,
  PowerSource,
  RawTodayFeed,
  StationMetadata,
  StationTelemetry,
} from '@/types/models';
import {
  BATTERY_IDLE_POWER_W,
  DATA_PROXY_URL,
  DIRECT_DATA_URL,
  POWER_SOURCE_THRESHOLD_W,
} from '@/constants/stations';

export function extractStationId(input: string): string | null {
  const trimmed = input.trim();
  const urlMatch = /fayna-ses\.funs\.net\.ua\/s\/([0-9a-f]{32})/i.exec(trimmed);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1].toLowerCase();
  }
  if (/^[0-9a-f]{32}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return null;
}

export function calculateBatteryState(batteryPower: number | null): BatteryState {
  if (batteryPower === null || Number.isNaN(batteryPower)) {
    return 'idle';
  }
  if (batteryPower > BATTERY_IDLE_POWER_W) {
    return 'discharging';
  }
  if (batteryPower < -BATTERY_IDLE_POWER_W) {
    return 'charging';
  }
  return 'idle';
}

export function calculatePowerSource(
  solarPower: number,
  gridPower: number,
  batteryPower: number,
  buildingPower: number
): PowerSource {
  if (solarPower > POWER_SOURCE_THRESHOLD_W && solarPower >= buildingPower) {
    return 'solar';
  }
  if (gridPower > POWER_SOURCE_THRESHOLD_W) {
    return 'grid';
  }
  if (batteryPower > POWER_SOURCE_THRESHOLD_W) {
    return 'battery';
  }
  if (solarPower > POWER_SOURCE_THRESHOLD_W) {
    return 'solar';
  }
  return 'idle';
}

/**
 * Smart fetch: attempts proxy route /api first, falls back to direct URL on failure
 */
async function smartFetch(subpath: string): Promise<any> {
  try {
    const res = await fetch(`${DATA_PROXY_URL}/${subpath}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (_) {
    // fallback to direct request
  }

  // Fallback
  const directRes = await fetch(`${DIRECT_DATA_URL}/${subpath}`, {
    headers: { Accept: 'application/json' },
  });
  if (!directRes.ok) {
    throw new Error(`Failed to fetch ${subpath} (${directRes.status})`);
  }
  return await directRes.json();
}

export async function fetchStationMetadata(stationId: string): Promise<StationMetadata> {
  const data = await smartFetch(`${stationId}/station.json`);
  return {
    id: stationId,
    name: data.name || `Station ${stationId.slice(0, 6)}`,
    description: data.description || '',
    inverterKw: typeof data.inverterKw === 'number' ? data.inverterKw : null,
    pvKw: typeof data.pvKw === 'number' ? data.pvKw : 0,
    batteryKwh: typeof data.batteryKwh === 'number' ? data.batteryKwh : 0,
  };
}

export async function fetchTodayFeed(stationId: string): Promise<RawTodayFeed> {
  return await smartFetch(`${stationId}/today.json`);
}

export async function fetchDayHistory(stationId: string, dateStr: string): Promise<RawTodayFeed> {
  return await smartFetch(`${stationId}/day/${dateStr}.json`);
}

export async function fetchMonthHistory(stationId: string, monthStr: string): Promise<{
  month: string;
  days: number[];
  pv: number[];
  grid: number[];
  load: number[];
}> {
  return await smartFetch(`${stationId}/month/${monthStr}.json`);
}

export async function fetchD1History(
  stationId: string,
  fromTs?: number,
  toTs?: number
): Promise<{
  stationId: string;
  from: number;
  to: number;
  count: number;
  t: number[];
  soc: (number | null)[];
  batt: (number | null)[];
  grid: (number | null)[];
  load: (number | null)[];
  pv: (number | null)[];
}> {
  const params = new URLSearchParams();
  if (fromTs) params.set('from', String(fromTs));
  if (toTs) params.set('to', String(toTs));
  const queryStr = params.toString() ? '?' + params.toString() : '';
  const url = `${DATA_PROXY_URL}/${stationId}/d1-history${queryStr}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch D1 history (${res.status})`);
  }
  return await res.json();
}


export function buildStationTelemetry(
  meta: StationMetadata,
  feed: RawTodayFeed
): StationTelemetry {
  const sampleCount = feed.t?.length || 0;
  const lastIndex = sampleCount > 0 ? sampleCount - 1 : -1;

  const batteryLevel = lastIndex >= 0 ? Number(feed.soc?.[lastIndex] ?? 0) : 0;
  const batteryPower = lastIndex >= 0 ? Number(feed.batt?.[lastIndex] ?? 0) : 0;
  const solarPower = lastIndex >= 0 ? Number(feed.pv?.[lastIndex] ?? 0) : 0;
  const gridPower = lastIndex >= 0 ? Number(feed.grid?.[lastIndex] ?? 0) : 0;
  const buildingPower = lastIndex >= 0 ? Number(feed.load?.[lastIndex] ?? 0) : 0;

  const capacityKwh = meta.batteryKwh || 0;
  const remainingEnergyKwh = (capacityKwh * batteryLevel) / 100;

  const loadHistory = feed.load || [];
  const peakLoadW = loadHistory.length > 0 ? Math.max(...loadHistory) : buildingPower;
  const invKw = meta.inverterKw ?? 0;
  const inverterLoadPercent = invKw > 0 ? Math.min(100, Math.round((buildingPower / (invKw * 1000)) * 100)) : 0;

  // Calculate historical average load (W) for realistic blackout autonomy forecasting
  const validLoads = loadHistory.filter((v: number | null) => v !== null && v > 50);
  const avgLoadW = validLoads.length > 0
    ? Math.round(validLoads.reduce((a: number, b: number) => a + b, 0) / validLoads.length)
    : 0;

  // Calculate estimated autonomy hours:
  // 1) If battery is actively discharging during blackout/high load (>150W), use current discharge rate
  // 2) If battery is idle/float charging, use recent building load or historical average daily load
  // Minimum realistic consumption baseline is 300W (standby pumps/controllers/lighting) to prevent infinite hours
  let estimatedAutonomyHours: number | null = null;
  if (remainingEnergyKwh > 0) {
    let effectiveDischargeW = 0;
    if (batteryPower > 150) {
      // Actively discharging
      effectiveDischargeW = batteryPower;
    } else {
      // Standby / On-grid: estimate how long battery will last when grid drops
      const referenceLoad = buildingPower > 150 ? buildingPower : avgLoadW;
      // Elevator backup or small entrance minimum 300W baseline
      effectiveDischargeW = Math.max(300, referenceLoad);
    }

    if (effectiveDischargeW > 0) {
      const dischargeKw = effectiveDischargeW / 1000;
      estimatedAutonomyHours = Math.round((remainingEnergyKwh / dischargeKw) * 10) / 10;
    }
  }

  const updatedStamp = feed.updated ? feed.updated * 1000 : null;
  const updatedAt = updatedStamp ? new Date(updatedStamp) : null;
  const nowStamp = Date.now();
  const ageSeconds = updatedStamp ? Math.max(0, Math.floor((nowStamp - updatedStamp) / 1000)) : 999999;
  const isStale = ageSeconds > 1800;

  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    inverterKw: invKw,
    pvKw: meta.pvKw ?? 0,
    batteryKwh: capacityKwh,
    isCustom: meta.isCustom,

    status: (feed.status as ConnectionStatus) || 'NORMAL',
    updatedAt,
    batteryLevel,
    batteryPower,
    solarPower,
    gridPower,
    buildingPower,

    batteryState: calculateBatteryState(batteryPower),
    powerSource: calculatePowerSource(solarPower, gridPower, batteryPower, buildingPower),
    remainingEnergyKwh,
    estimatedAutonomyHours,

    solarEnergyTodayKwh: Number(feed.day?.pv ?? 0),
    buildingEnergyTodayKwh: Number(feed.day?.load ?? 0),
    gridEnergyTodayKwh: Number(feed.day?.grid ?? 0),
    peakLoadW,
    inverterLoadPercent,

    isStale,
    ageSeconds,

    history: {
      timestamps: feed.t || [],
      soc: feed.soc || [],
      batt: feed.batt || [],
      pv: feed.pv || [],
      load: feed.load || [],
      grid: feed.grid || [],
    },
  };
}
