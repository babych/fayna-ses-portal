import { describe, it, expect } from 'vitest';

/**
 * Contract verification test suite for Web Push notification silence & urgency logic.
 * Enforces the architectural rule:
 * - Full outage (100% of stations off) & Full power restoration (0 stations off) -> AUDIBLE / URGENT (silent: false, urgency: high, apns-priority: 10)
 * - Partial outage (voltage fluctuations / only some stations off, e.g. 1..N-1) -> SILENT / DISCREET (silent: true, urgency: low, apns-priority: 5)
 */

interface PushPolicyInput {
  currentBlackoutCount: number;
  totalActiveStations: number;
  scope: string; // 'all' or specific station id
}

interface PushPolicyResult {
  isPartialOutage: boolean;
  silent: boolean;
  urgency: 'low' | 'high';
  apnsPriority?: '5' | '10';
}

function evaluatePushNotificationPolicy(input: PushPolicyInput): PushPolicyResult {
  const { currentBlackoutCount, totalActiveStations, scope } = input;
  const isPartialOutage = currentBlackoutCount > 0 && currentBlackoutCount < totalActiveStations;
  
  // Rule: for general broadcast (scope === 'all'), partial outages must be silent
  const silent = scope === 'all' ? isPartialOutage : false;
  const urgency: 'low' | 'high' = silent ? 'low' : 'high';
  const apnsPriority: '5' | '10' = silent ? '5' : '10';

  return {
    isPartialOutage,
    silent,
    urgency,
    apnsPriority,
  };
}

describe('Web Push Notification Silence & Vibration Standards', () => {
  const TOTAL_STATIONS = 9;

  it('enforces silent: true and low urgency when partial stations are in blackout (e.g. 1 out of 9)', () => {
    const result = evaluatePushNotificationPolicy({
      currentBlackoutCount: 1,
      totalActiveStations: TOTAL_STATIONS,
      scope: 'all',
    });

    expect(result.isPartialOutage).toBe(true);
    expect(result.silent).toBe(true);
    expect(result.urgency).toBe('low');
    expect(result.apnsPriority).toBe('5');
  });

  it('enforces silent: true and low urgency when multiple but not all stations are in blackout (e.g. 4 out of 9)', () => {
    const result = evaluatePushNotificationPolicy({
      currentBlackoutCount: 4,
      totalActiveStations: TOTAL_STATIONS,
      scope: 'all',
    });

    expect(result.isPartialOutage).toBe(true);
    expect(result.silent).toBe(true);
    expect(result.urgency).toBe('low');
    expect(result.apnsPriority).toBe('5');
  });

  it('enforces silent: false and high urgency on FULL BLACKOUT (all 9 stations off)', () => {
    const result = evaluatePushNotificationPolicy({
      currentBlackoutCount: 9,
      totalActiveStations: TOTAL_STATIONS,
      scope: 'all',
    });

    expect(result.isPartialOutage).toBe(false);
    expect(result.silent).toBe(false);
    expect(result.urgency).toBe('high');
    expect(result.apnsPriority).toBe('10');
  });

  it('enforces silent: false and high urgency on FULL POWER RESTORATION (0 stations off)', () => {
    const result = evaluatePushNotificationPolicy({
      currentBlackoutCount: 0,
      totalActiveStations: TOTAL_STATIONS,
      scope: 'all',
    });

    expect(result.isPartialOutage).toBe(false);
    expect(result.silent).toBe(false);
    expect(result.urgency).toBe('high');
    expect(result.apnsPriority).toBe('10');
  });

  it('preserves audible alert when user subscribes to their specific station (scope !== all)', () => {
    const result = evaluatePushNotificationPolicy({
      currentBlackoutCount: 2, // partial complex
      totalActiveStations: TOTAL_STATIONS,
      scope: 'cc5a340c80f5ce04158291f4aac365a6', // user specific building
    });

    expect(result.isPartialOutage).toBe(true);
    // User specifically subscribed to their building, so their direct building outage remains audible
    expect(result.silent).toBe(false);
    expect(result.urgency).toBe('high');
  });
});
