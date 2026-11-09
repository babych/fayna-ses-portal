import { describe, it, expect } from 'vitest';

/**
 * Contract verification test suite for Web Push notification silence & urgency logic.
 * Enforces the architectural rule:
 * - Full outage (100% of stations off) -> AUDIBLE / URGENT (silent: false, urgency: high, apns-priority: 10)
 * - Full power restoration ONLY AFTER Full Outage (current = 0, prev = all) -> AUDIBLE / URGENT (silent: false, urgency: high, apns-priority: 10)
 * - Power recovery after Partial Outage (current = 0, prev < all) -> SILENT / DISCREET (silent: true, urgency: low, apns-priority: 5)
 * - Partial outage (voltage fluctuations / only some stations off, e.g. 1..N-1) -> SILENT / DISCREET (silent: true, urgency: low, apns-priority: 5)
 */

interface PushPolicyInput {
  currentBlackoutCount: number;
  prevBlackoutCount: number;
  totalActiveStations: number;
  scope: string; // 'all' or specific station id
}

interface PushPolicyResult {
  isPartialOutage: boolean;
  isFullBlackout: boolean;
  isRestorationAfterFullBlackout: boolean;
  isAudibleComplexEvent: boolean;
  silent: boolean;
  urgency: 'low' | 'high';
  apnsPriority?: '5' | '10';
}

function evaluatePushNotificationPolicy(input: PushPolicyInput): PushPolicyResult {
  const { currentBlackoutCount, prevBlackoutCount, totalActiveStations, scope } = input;
  const isPartialOutage = currentBlackoutCount > 0 && currentBlackoutCount < totalActiveStations;
  const isFullBlackout = currentBlackoutCount === totalActiveStations;
  const isRestorationAfterFullBlackout = currentBlackoutCount === 0 && prevBlackoutCount === totalActiveStations;
  const isAudibleComplexEvent = isFullBlackout || isRestorationAfterFullBlackout;
  
  // Rule: for general broadcast (scope === 'all'), only full blackout and restoration after full blackout are audible
  const silent = scope === 'all' ? !isAudibleComplexEvent : false;
  const urgency: 'low' | 'high' = silent ? 'low' : 'high';
  const apnsPriority: '5' | '10' = silent ? '5' : '10';

  return {
    isPartialOutage,
    isFullBlackout,
    isRestorationAfterFullBlackout,
    isAudibleComplexEvent,
    silent,
    urgency,
    apnsPriority,
  };
}

describe('Web Push Notification Silence & Vibration Standards', () => {
  const TOTAL_STATIONS = 9;

  it('enforces silent: true and low urgency when partial stations enter blackout (e.g. 1 out of 9)', () => {
    const result = evaluatePushNotificationPolicy({
      currentBlackoutCount: 1,
      prevBlackoutCount: 0,
      totalActiveStations: TOTAL_STATIONS,
      scope: 'all',
    });

    expect(result.isPartialOutage).toBe(true);
    expect(result.isAudibleComplexEvent).toBe(false);
    expect(result.silent).toBe(true);
    expect(result.urgency).toBe('low');
    expect(result.apnsPriority).toBe('5');
  });

  it('enforces silent: true and low urgency when multiple but not all stations enter blackout (e.g. 4 out of 9)', () => {
    const result = evaluatePushNotificationPolicy({
      currentBlackoutCount: 4,
      prevBlackoutCount: 1,
      totalActiveStations: TOTAL_STATIONS,
      scope: 'all',
    });

    expect(result.isPartialOutage).toBe(true);
    expect(result.isAudibleComplexEvent).toBe(false);
    expect(result.silent).toBe(true);
    expect(result.urgency).toBe('low');
    expect(result.apnsPriority).toBe('5');
  });

  it('enforces silent: false and high urgency on FULL BLACKOUT (all 9 stations off)', () => {
    const result = evaluatePushNotificationPolicy({
      currentBlackoutCount: 9,
      prevBlackoutCount: 4,
      totalActiveStations: TOTAL_STATIONS,
      scope: 'all',
    });

    expect(result.isFullBlackout).toBe(true);
    expect(result.isAudibleComplexEvent).toBe(true);
    expect(result.silent).toBe(false);
    expect(result.urgency).toBe('high');
    expect(result.apnsPriority).toBe('10');
  });

  it('enforces silent: false and high urgency on FULL RESTORATION AFTER FULL BLACKOUT (0 stations off, prev = 9)', () => {
    const result = evaluatePushNotificationPolicy({
      currentBlackoutCount: 0,
      prevBlackoutCount: 9, // previously in full blackout
      totalActiveStations: TOTAL_STATIONS,
      scope: 'all',
    });

    expect(result.isRestorationAfterFullBlackout).toBe(true);
    expect(result.isAudibleComplexEvent).toBe(true);
    expect(result.silent).toBe(false);
    expect(result.urgency).toBe('high');
    expect(result.apnsPriority).toBe('10');
  });

  it('enforces silent: true and low urgency when power returns after a PARTIAL outage (0 stations off, prev = 2)', () => {
    const result = evaluatePushNotificationPolicy({
      currentBlackoutCount: 0,
      prevBlackoutCount: 2, // previously only partial fluctuation
      totalActiveStations: TOTAL_STATIONS,
      scope: 'all',
    });

    // Should NOT ring or vibrate because the outage was only partial!
    expect(result.isRestorationAfterFullBlackout).toBe(false);
    expect(result.isAudibleComplexEvent).toBe(false);
    expect(result.silent).toBe(true);
    expect(result.urgency).toBe('low');
    expect(result.apnsPriority).toBe('5');
  });

  it('preserves audible alert when user subscribes to their specific station (scope !== all)', () => {
    const result = evaluatePushNotificationPolicy({
      currentBlackoutCount: 0,
      prevBlackoutCount: 2, // partial complex
      totalActiveStations: TOTAL_STATIONS,
      scope: 'cc5a340c80f5ce04158291f4aac365a6', // user specific building
    });

    // User specifically subscribed to their building, so their direct building restoration remains audible
    expect(result.silent).toBe(false);
    expect(result.urgency).toBe('high');
  });
});
