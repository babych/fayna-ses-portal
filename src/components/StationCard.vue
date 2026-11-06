<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Share2, Check } from 'lucide-vue-next';
import type { StationTelemetry } from '@/types/models';
import BatteryVisual from './BatteryVisual.vue';
import PowerFlowCard from './PowerFlowCard.vue';
import { useStationI18n } from '@/composables/useStationI18n';

const { t } = useI18n();
const { getStationName, getStationDesc } = useStationI18n();

const props = defineProps<{
  station: StationTelemetry;
  isInitialLoading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'show-history', station: StationTelemetry): void;
  (e: 'remove', id: string): void;
}>();

const copied = ref(false);

const isElevator = computed(() => {
  return /elevator|ліфт/i.test(props.station.name) || /elevator|ліфт/i.test(props.station.description || '');
});

const isDeadDuringBlackout = computed(() => {
  return props.station.isStale && props.station.gridPower === 0;
});

const shareStation = async () => {
  const url = `${window.location.origin}/?station=${props.station.id}`;
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(url).catch(() => {});
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  }
};

const formatTimeAgo = (seconds: number) => {
  if (seconds < 60) return t('secAgo', { n: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('minAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  return t('hAgo', { n: hours });
};
</script>

<template>
  <div 
    class="group relative rounded-xl bg-white border border-slate-200/90 p-5 shadow-sm hover:shadow-xl hover:border-slate-300 transition-[box-shadow,border-color] duration-300 flex flex-col justify-between"
  >
    <div>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <button
              type="button"
              @click="emit('show-history', station)"
              @pointerenter="import('@/components/StationHistoryModal.vue').catch(() => {})"
              class="text-left group/title focus:outline-none"
              :title="t('analytics')"
            >
              <h3 class="text-base font-extrabold text-slate-900 tracking-tight truncate group-hover/title:text-emerald-600 transition-colors cursor-pointer">
                {{ getStationName(station) }}
              </h3>
            </button>
            <span v-if="station.isCustom" class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              {{ t('custom') }}
            </span>
          </div>
          <p class="text-xs text-slate-500 mt-0.5 min-h-[16px] truncate">
            {{ getStationDesc(station) || 'Power station' }}
          </p>
          <div class="flex items-center gap-1.5 mt-2 flex-wrap min-h-[22px]">
            <span v-if="station.inverterKw > 0" class="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
              ⚡ {{ t('history.inverter') }}: {{ station.inverterKw }} {{ t('kwUnit') }}
            </span>
            <span v-if="station.inverterKw > 0" class="inline-flex items-center justify-center w-[38px] min-w-[38px] py-0.5 rounded-md text-[10px] font-bold tabular-nums shrink-0" :class="station.inverterLoadPercent > 70 ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-slate-100 text-slate-600 border border-slate-200'">
              {{ station.inverterLoadPercent }}%
            </span>
            <span v-if="station.batteryKwh > 0" class="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 tabular-nums shrink-0">
              🔋 {{ station.batteryKwh }} {{ t('kwhUnit') }}
            </span>
            <span v-if="station.pvKw > 0" class="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
              ☀️ {{ station.pvKw }} {{ t('kwUnit') }}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-1.5">
          <button
            @click="shareStation"
            class="p-2 rounded-lg bg-slate-50 border border-slate-200 transition-all"
            :class="copied ? 'text-emerald-700 bg-emerald-50 border-emerald-300' : 'text-slate-500 hover:text-emerald-700 hover:bg-emerald-50'"
            :title="copied ? t('copied') : t('share')"
          >
            <Check v-if="copied" class="w-4 h-4 text-emerald-600" />
            <Share2 v-else class="w-4 h-4" />
          </button>
        </div>
      </div>

      <div class="my-5 flex justify-center py-2">
        <BatteryVisual
          :level="station.batteryLevel"
          :power="station.batteryPower"
          :state="station.batteryState"
          :capacity-kwh="station.batteryKwh"
          :remaining-kwh="station.remainingEnergyKwh"
          :autonomy-hours="station.estimatedAutonomyHours"
          :is-initial-loading="isInitialLoading"
          :is-drained="station.isDrained"
        />
      </div>

      <PowerFlowCard
        :solar-power="station.solarPower"
        :has-pv="station.pvKw > 0"
        :grid-power="station.gridPower"
        :battery-power="station.batteryPower"
        :building-power="station.buildingPower"
        :battery-level="station.batteryLevel"
        :battery-state="station.batteryState"
        :power-source="station.powerSource"
        :is-stale="station.isStale"
        :is-drained="station.isDrained"
        :is-initial-loading="isInitialLoading"
      />
    </div>

    <!-- Card Footer -->
    <div class="mt-4 pt-3 border-t border-slate-100 flex flex-col gap-2">
      <div class="flex items-center justify-between text-xs text-slate-500 h-[20px]">
        <div class="flex items-center gap-1.5 min-w-0 flex-1 mr-2 truncate">
          <span 
            class="w-2 h-2 rounded-full shrink-0"
            :class="isInitialLoading ? 'bg-slate-300' : station.isDrained ? 'bg-rose-500' : station.isStale ? 'bg-amber-500' : 'bg-emerald-500'"
          ></span>
          <span :class="!isInitialLoading && station.isDrained ? 'text-rose-600 font-bold' : !isInitialLoading && station.isStale ? 'text-amber-600 font-bold' : 'font-medium'" class="shrink-0">
            {{ isInitialLoading ? '—' : station.isDrained ? t('drainedTag') : station.isStale ? t('stale') : t('online') }}
          </span>
          <span class="text-slate-300 shrink-0">•</span>
          <span class="text-slate-400 tabular-nums shrink-0">{{ isInitialLoading ? '—' : formatTimeAgo(station.ageSeconds) }}</span>
          <span 
            v-if="!isInitialLoading && station.isStale"
            class="text-[11px] text-amber-700 font-medium truncate ml-1"
            :title="isElevator && isDeadDuringBlackout ? t('staleElevatorBlackout') : t('staleBanner', { time: formatTimeAgo(station.ageSeconds) })"
          >
            ({{ station.isDrained ? t('staleElevatorBlackout') : (isElevator && isDeadDuringBlackout ? t('staleElevatorBlackout') : t('stale')) }})
          </span>
        </div>

        <div class="flex items-center gap-3 shrink-0">
          <button
            @click="emit('show-history', station)"
            @pointerenter="import('@/components/StationHistoryModal.vue').catch(() => {})"
            class="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 shrink-0"
          >
            {{ t('analytics') }} →
          </button>
          <button
            v-if="station.isCustom"
            @click="emit('remove', station.id)"
            class="text-xs text-rose-500 hover:text-rose-700 shrink-0"
          >
            {{ t('delete') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
