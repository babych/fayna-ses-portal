/**
 * Core Data Models for Fayna SES Portal
 */

export type BatteryState = 'charging' | 'discharging' | 'idle';
export type PowerSource = 'solar' | 'grid' | 'battery' | 'idle';
export type ConnectionStatus = 'NORMAL' | 'PARTIAL_OFFLINE' | 'ALL_OFFLINE' | 'NO_DEVICE';

export interface StationMetadata {
  id: string;
  name: string;
  description: string;
  inverterKw: number | null;
  pvKw: number | null;
  batteryKwh: number | null;
  isCustom?: boolean;
}

export interface RawTodayFeed {
  date: string;
  updated: number;
  status: ConnectionStatus | string;
  t: number[];
  soc: number[];
  pv: number[];
  grid: number[];
  batt: number[];
  load: number[];
  day?: {
    pv: number;
    load: number;
    grid?: number;
  };
  prev?: string;
}

export interface StationTelemetry {
  id: string;
  name: string;
  description: string;
  inverterKw: number;
  pvKw: number;
  batteryKwh: number;
  isCustom?: boolean;

  // Real-time telemetry readings
  status: ConnectionStatus;
  updatedAt: Date | null;
  batteryLevel: number; // SoC % (0-100)
  batteryPower: number; // W (+ discharge, - charge)
  solarPower: number;   // W
  gridPower: number;    // W
  buildingPower: number;// W

  // Computed states
  batteryState: BatteryState;
  powerSource: PowerSource;
  remainingEnergyKwh: number;
  estimatedAutonomyHours: number | null; // estimated hours remaining

  // Daily statistics
  solarEnergyTodayKwh: number;
  buildingEnergyTodayKwh: number;
  gridEnergyTodayKwh: number;
  peakLoadW: number;
  inverterLoadPercent: number;

  // Telemetry freshness
  isStale: boolean;
  ageSeconds: number;

  // Rolling 24h history for charts
  history: {
    timestamps: number[];
    soc: number[];
    batt: number[];
    pv: number[];
    load: number[];
    grid: number[];
  };
}

export interface ComplexAggregate {
  totalStations: number;
  onlineStations: number;
  totalBatteryCapacityKwh: number;
  currentStoredEnergyKwh: number;
  averageBatteryLevel: number;
  totalSolarPowerW: number;
  totalGridPowerW: number;
  totalBatteryPowerW: number;
  totalBuildingPowerW: number;
  isBlackout: boolean; // true if grid is offline (total or partial)
  blackoutStatus: 'normal' | 'partial' | 'full'; // granular grid state
  blackoutCount: number; // number of stations in blackout
  blackoutDurationMinutes?: number; // total ongoing outage duration in minutes
  estimatedComplexAutonomyHours: number | null;
}
