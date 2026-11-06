import { describe, it, expect } from 'vitest';
import {
  computeBlackoutIntervals,
  computeHourlyBlackoutMinutes,
  computeHourlyStats,
} from './blackout';

describe('Blackout analytics utilities', () => {
  it('correctly detects no outages when grid is active', () => {
    const timestamps = [1700000000, 1700000300, 1700000600];
    const grid = [2300, 2400, 2200];
    const load = [1500, 1600, 1500];

    const intervals = computeBlackoutIntervals(timestamps, grid, load, false);
    expect(intervals).toHaveLength(0);

    const hourlyMinutes = computeHourlyBlackoutMinutes(intervals);
    expect(hourlyMinutes.every(m => m === 0)).toBe(true);
  });

  it('detects a single completed blackout interval', () => {
    // Epoch: 1700000000
    // Start blackout at t[1], end at t[3]
    const base = 1700000000;
    const timestamps = [base, base + 300, base + 600, base + 900, base + 1200];
    const grid = [2000, 0, 0, 2200, 2200];
    const load = [1000, 1000, 1000, 1000, 1000];

    const intervals = computeBlackoutIntervals(timestamps, grid, load, false);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].isOngoing).toBe(false);
    expect(intervals[0].durationMinutes).toBe(10); // 600s = 10 min
  });

  it('detects blackout if load is low or zero but battery is discharging (b > 50W)', () => {
    const base = 1700000000;
    const timestamps = [base, base + 300, base + 600];
    const grid = [0, 0, 0];
    const load = [0, 0, 0];
    const batt = [300, 300, 300];

    const intervals = computeBlackoutIntervals(timestamps, grid, load, false, batt);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].isOngoing).toBe(true);
  });

  it('marks active blackout as isOngoing if last sample is in blackout on current day', () => {
    const base = 1700000000;
    const timestamps = [base, base + 300, base + 600];
    const grid = [2000, 0, 0];
    const load = [1000, 1000, 1000];

    const intervals = computeBlackoutIntervals(timestamps, grid, load, false);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].isOngoing).toBe(true);
  });

  it('does NOT mark active blackout as isOngoing when viewing history day', () => {
    const base = 1700000000;
    const timestamps = [base, base + 300, base + 600];
    const grid = [2000, 0, 0];
    const load = [1000, 1000, 1000];

    const intervals = computeBlackoutIntervals(timestamps, grid, load, true);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].isOngoing).toBe(false);
  });

  it('correctly splits multi-hour outage into hourly minutes and flags ongoing hour', () => {
    // Blackout from 10:40 to 11:35 (total 55m: 20m in hour 10, 35m in hour 11)
    const d1 = new Date('2026-11-02T10:40:00');
    const d2 = new Date('2026-11-02T11:35:00');
    const intervals = [
      {
        start: d1,
        end: d2,
        durationMinutes: 55,
        isOngoing: true,
      },
    ];

    const hourlyMinutes = computeHourlyBlackoutMinutes(intervals);
    expect(hourlyMinutes[10]).toBe(20);
    expect(hourlyMinutes[11]).toBe(35);

    const stats = computeHourlyStats(hourlyMinutes, intervals, 11);
    // Hour 10 is completed partial outage (20m)
    expect(stats[10].level).toBe('partial');
    expect(stats[10].minutes).toBe(20);
    expect(stats[10].isOngoing).toBe(false);

    // Hour 11 is ongoing partial outage (35m)
    expect(stats[11].level).toBe('partial');
    expect(stats[11].minutes).toBe(35);
    expect(stats[11].isOngoing).toBe(true);

    // Hour 12 is in the future
    expect(stats[12].level).toBe('future');
  });

  it('treats 55m+ in an hour as full blackout level', () => {
    const d1 = new Date('2026-11-02T14:02:00');
    const d2 = new Date('2026-11-02T14:59:00');
    const intervals = [
      {
        start: d1,
        end: d2,
        durationMinutes: 57,
        isOngoing: false,
      },
    ];

    const hourlyMinutes = computeHourlyBlackoutMinutes(intervals);
    expect(hourlyMinutes[14]).toBe(57);

    const stats = computeHourlyStats(hourlyMinutes, intervals, 15);
    expect(stats[14].level).toBe('full');
    expect(stats[14].minutes).toBe(57);
  });

  it('buildHourlyGradient creates exact sub-hour position gradient with green on left and right', async () => {
    const { buildHourlyGradient } = await import('./blackout');
    // Outage in the middle: minute 15 to 45 (25% to 75%)
    const segments = [
      { startMinute: 15, endMinute: 45, startPercent: 25.0, endPercent: 75.0 }
    ];
    const grad = buildHourlyGradient(segments, false, 50);
    expect(grad).toContain('#16A34A 0.0%');
    expect(grad).toContain('#16A34A 25.0%');
    expect(grad).toContain('#B91C1C 25.0%');
    expect(grad).toContain('#B91C1C 75.0%');
    expect(grad).toContain('#16A34A 75.0%');
    expect(grad).toContain('#16A34A 100%');
  });
  it('bridges outages when power returns for <= 30 minutes', () => {
    // 300s sample step (5 min).
    // Outage 1: t[1] to t[3] (10 min)
    // Light for 20 min: t[3] to t[7] (20 min <= 30 min gap)
    // Outage 2: t[7] to t[9] (10 min)
    const base = 1700000000;
    const timestamps = [base, base + 300, base + 600, base + 900, base + 1200, base + 1500, base + 1800, base + 2100, base + 2400, base + 2700];
    const grid = [2000, 0, 0, 2200, 2200, 2200, 2200, 0, 0, 2200];
    const load = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000];

    const intervals = computeBlackoutIntervals(timestamps, grid, load, false, [], 30);
    // Bridged into 1 single outage
    expect(intervals).toHaveLength(1);
    expect(intervals[0].durationMinutes).toBe(40);
  });
});
