/**
 * Utility functions for computing blackout intervals, hourly outage minutes,
 * and cell styling/percentage stats.
 */

export type HourlyBlackoutLevel = 'none' | 'partial' | 'full' | 'future';

export interface PowerInterval {
  start: Date;
  end: Date;
  durationMinutes: number;
  isOngoing?: boolean;
}

export type BlackoutInterval = PowerInterval;

export interface ContinuousPowerEvent {
  id: string;
  type: 'outage' | 'power';
  start: Date;
  end: Date;
  durationMinutes: number;
  crossesMidnight: boolean;
  isOngoing?: boolean;
}

export interface HourlyBlackoutStat {
  level: HourlyBlackoutLevel;
  minutes: number;
  percent: number;
  isOngoing?: boolean;
  tooltipText: string;
  matchingOutage?: BlackoutInterval;
  matchingPower?: PowerInterval;
}

export function computePowerIntervals(
  timestamps: number[],
  grid: number[],
  load: number[],
  isHistoryDay: boolean = false,
  batt: number[] = [],
  findType: 'outage' | 'power' = 'power'
): PowerInterval[] {
  if (!timestamps || timestamps.length === 0) return [];

  let inState = false;
  let startTime = 0;
  const intervals: PowerInterval[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    if (timestamps[i] === null || (grid[i] === null && load[i] === null)) continue;
    const g = grid[i] ?? 0;
    const l = load[i] ?? 0;
    const b = batt[i] ?? 0;
    const isOutage = Math.abs(g) <= 20 && (l > 20 || b > 50);
    const matches = findType === 'outage' ? isOutage : !isOutage;

    if (matches && !inState) {
      inState = true;
      startTime = timestamps[i];
    } else if (!matches && inState) {
      inState = false;
      const end = timestamps[i];
      const duration = Math.max(1, Math.round((end - startTime) / 60));
      intervals.push({
        start: new Date(startTime * 1000),
        end: new Date(end * 1000),
        durationMinutes: duration,
        isOngoing: false,
      });
    }
  }

  if (inState && startTime) {
    const end = timestamps[timestamps.length - 1];
    intervals.push({
      start: new Date(startTime * 1000),
      end: new Date(end * 1000),
      durationMinutes: Math.max(1, Math.round((end - startTime) / 60)),
      isOngoing: !isHistoryDay,
    });
  }

  return intervals;
}

export function computeBlackoutIntervals(
  timestamps: number[],
  grid: number[],
  load: number[],
  isHistoryDay: boolean = false,
  batt: number[] = []
): BlackoutInterval[] {
  return computePowerIntervals(timestamps, grid, load, isHistoryDay, batt, 'outage');
}

export function computeHourlyBlackoutMinutes(
  intervals: BlackoutInterval[],
  referenceDate?: string
): number[] {
  const hourlyMinutes = Array(24).fill(0);
  if (!intervals.length) return hourlyMinutes;

  for (const item of intervals) {
    const itemStartMs = item.start.getTime();
    const itemEndMs = item.end.getTime();
    if (itemEndMs <= itemStartMs) continue;

    // Determine the base day from referenceDate or item.start
    let dayBase: Date;
    if (referenceDate) {
      const parts = referenceDate.split('-').map(Number);
      dayBase = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
    } else {
      dayBase = new Date(item.start.getFullYear(), item.start.getMonth(), item.start.getDate(), 0, 0, 0, 0);
    }

    const dayStartMs = dayBase.getTime();

    for (let h = 0; h < 24; h++) {
      const hourStartMs = dayStartMs + h * 3600 * 1000;
      const hourEndMs = hourStartMs + 3600 * 1000;

      const overlapStart = Math.max(itemStartMs, hourStartMs);
      const overlapEnd = Math.min(itemEndMs, hourEndMs);

      if (overlapEnd > overlapStart) {
        const minutes = Math.round((overlapEnd - overlapStart) / 60000);
        hourlyMinutes[h] = Math.min(60, hourlyMinutes[h] + minutes);
      }
    }
  }

  return hourlyMinutes;
}

export function computeHourlyStats(
  hourlyMinutes: number[],
  intervals: BlackoutInterval[],
  currentTelemetryHour: number
): HourlyBlackoutStat[] {
  return hourlyMinutes.map((m, h) => {
    if (h > currentTelemetryHour) {
      return {
        level: 'future',
        minutes: 0,
        percent: 0,
        tooltipText: `${h}:00 — Future`,
      };
    }

    const percent = Math.min(100, Math.round((m / 60) * 100));
    let level: HourlyBlackoutLevel = 'none';
    if (m >= 55) level = 'full';
    else if (m > 0) level = 'partial';

    const matchingIntervals = intervals.filter(it => {
      const sH = it.start.getHours();
      const eH = it.end.getHours();
      return h >= sH && h <= eH;
    });

    const isOngoingInThisHour = matchingIntervals.some(it => it.isOngoing && h === currentTelemetryHour);

    return {
      level,
      minutes: m,
      percent,
      isOngoing: isOngoingInThisHour,
      tooltipText: `${h}:00 — ${m} min`,
    };
  });
}
