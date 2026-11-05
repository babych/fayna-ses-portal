import { useI18n } from 'vue-i18n';
import type { StationTelemetry } from '@/types/models';

/**
 * Resolves localized station names and descriptions dynamically
 */
export function useStationI18n() {
  const { te, t } = useI18n();

  const getStationName = (station: { id: string; name: string }) => {
    const key = `stations.${station.id}.name`;
    return te(key) ? t(key) : station.name;
  };

  const getStationDesc = (station: { id: string; description?: string }) => {
    const key = `stations.${station.id}.description`;
    return te(key) ? t(key) : (station.description || '');
  };

  return {
    getStationName,
    getStationDesc,
  };
}
