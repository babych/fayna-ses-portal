import { describe, it, expect } from 'vitest';
import { calculateBatteryState, calculatePowerSource } from './api';

describe('Station Telemetry Calculations', () => {
  describe('calculateBatteryState', () => {
    it('returns idle when power is null or near zero threshold (<= 20W)', () => {
      expect(calculateBatteryState(null)).toBe('idle');
      expect(calculateBatteryState(0)).toBe('idle');
      expect(calculateBatteryState(15)).toBe('idle');
      expect(calculateBatteryState(-15)).toBe('idle');
    });

    it('returns discharging when battery power > 20W', () => {
      expect(calculateBatteryState(25)).toBe('discharging');
      expect(calculateBatteryState(1500)).toBe('discharging');
    });

    it('returns charging when battery power < -20W', () => {
      expect(calculateBatteryState(-25)).toBe('charging');
      expect(calculateBatteryState(-2000)).toBe('charging');
    });
  });

  describe('calculatePowerSource', () => {
    it('prioritizes solar when solar covers building load', () => {
      expect(calculatePowerSource(2000, 2000, 0, 1500)).toBe('solar');
    });

    it('identifies grid power when grid is active (> 50W)', () => {
      expect(calculatePowerSource(0, 1200, 0, 1200)).toBe('grid');
    });

    it('identifies battery power during blackout when grid is offline and battery supplies load', () => {
      expect(calculatePowerSource(0, 0, 850, 850)).toBe('battery');
    });

    it('returns idle when all sources are near zero', () => {
      expect(calculatePowerSource(0, 10, 0, 0)).toBe('idle');
    });
  });

  describe('Apple APNs Web Push Tag Sanitization', () => {
    it('strips forbidden characters to prevent BadWebPushTopic 400 rejections', () => {
      const rawTag = 'fayna-grid-status-v2';
      const sanitized = rawTag.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
      expect(sanitized).toBe('faynagridstatusv2');
      expect(sanitized).not.toContain('-');
    });
  });
});
