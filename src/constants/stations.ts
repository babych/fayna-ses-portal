import type { StationMetadata, StationTelemetry } from '@/types/models';

/**
 * Cloudflare Pages Functions proxy (/api/...) in production or direct endpoint
 */
export const DATA_PROXY_URL = '/api';
export const DIRECT_DATA_URL = 'https://data-ses.funs.net.ua/s';
export const DASHBOARD_BASE_URL = 'https://fayna-ses.funs.net.ua/s';

export const BATTERY_IDLE_POWER_W = 20;
export const POWER_SOURCE_THRESHOLD_W = 50;

export const PRECONFIGURED_STATIONS: StationMetadata[] = [
  {
    id: 'cc5a340c80f5ce04158291f4aac365a6',
    name: 'HOA #2, Building 1, Entrance 5',
    description: 'Station serves building 1, entrances 2-5',
    inverterKw: 15,
    pvKw: 0,
    batteryKwh: 60,
  },
  {
    id: '366ae83e5947dbd6b6d30372f916a71f',
    name: 'HOA #4, Building 9, Entrance 8',
    description: 'Station serves building 9, entrances 4-8',
    inverterKw: 12,
    pvKw: 0,
    batteryKwh: 25,
  },
  {
    id: '91d435460f4c38741aa0ee07808a5960',
    name: 'HOA #6, Building 18, Entrance 7',
    description: 'Station serves building 18, entrances 5-8',
    inverterKw: 15,
    pvKw: 0,
    batteryKwh: 60,
  },
  {
    id: 'e64791f0a8f89a5400db11c0f8c82c57',
    name: 'HOA #6, Building 18, Entrance 8 - Elevator',
    description: 'Backup power for elevator, building 18, entrance 8',
    inverterKw: 20,
    pvKw: 0,
    batteryKwh: 20,
  },
  {
    id: 'ac15fb3d463174465df3bedcb30be9cc',
    name: 'HOA #7, Building 24, Entrance 2',
    description: 'Station serves building 24, entrances 1-2',
    inverterKw: 12,
    pvKw: 0,
    batteryKwh: 20,
  },
  {
    id: 'dee052e69e8fa101de2f002f53a964e2',
    name: 'HOA #6, Building 19, Entrance 1',
    description: 'Station serves all of building 19',
    inverterKw: 12,
    pvKw: 0,
    batteryKwh: 25,
  },
  {
    id: '8fd92183d607f5990c7e1dac509ec68a',
    name: 'HOA #3, Building 8, Entrance 5',
    description: 'Station serves building 8, entrances 3-5',
    inverterKw: 12,
    pvKw: 5,
    batteryKwh: 20,
  },
  {
    id: '4f655c36051a572e646a09bd6dc67d66',
    name: 'HOA #3, Building 7, Entrance 8',
    description: 'Station serves building 7, entrances 5-8',
    inverterKw: 12,
    pvKw: 5,
    batteryKwh: 25,
  },
  {
    id: '7cfb64881a9fa84997bf7e1bdb8e5071',
    name: 'HOA #7, Building 24, Entrance 5',
    description: 'Station serves building 24, entrances 4-5',
    inverterKw: 12,
    pvKw: 0,
    batteryKwh: 20,
  },
];

/**
 * Creates static placeholder telemetry objects for preconfigured stations.
 * This ensures the cards exist in the DOM from the very first frame (Zero-CLS),
 * matching the rock-solid stability of the Hero Overview banner.
 */
export function createInitialStationTelemetries(stations: StationMetadata[] = PRECONFIGURED_STATIONS): StationTelemetry[] {
  return stations.map((st) => ({
    id: st.id,
    name: st.name,
    description: st.description,
    inverterKw: st.inverterKw ?? 0,
    pvKw: st.pvKw ?? 0,
    batteryKwh: st.batteryKwh ?? 0,
    isCustom: st.isCustom,

    status: 'NORMAL',
    updatedAt: null,
    batteryLevel: 0,
    batteryPower: 0,
    solarPower: 0,
    gridPower: 0,
    buildingPower: 0,

    batteryState: 'idle',
    powerSource: 'idle',
    remainingEnergyKwh: 0,
    estimatedAutonomyHours: null,

    solarEnergyTodayKwh: 0,
    buildingEnergyTodayKwh: 0,
    gridEnergyTodayKwh: 0,
    peakLoadW: 0,
    inverterLoadPercent: 0,

    isStale: false,
    isDrained: false,
    ageSeconds: 0,

    history: {
      timestamps: [],
      soc: [],
      batt: [],
      pv: [],
      load: [],
      grid: [],
    },
  }));
}

