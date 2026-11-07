<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Battery, Sun, Building2, ShieldAlert, Sparkles, Clock, CheckCircle } from 'lucide-vue-next';
import type { ComplexAggregate } from '@/types/models';

const { t } = useI18n();

const props = defineProps<{
  stats: ComplexAggregate;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'open-complex-outages'): void;
}>();

const formatDuration = (totalMinutes?: number) => {
  if (!totalMinutes || totalMinutes <= 0) return '';
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) {
    return `${h} ${t('hUnit')} ${m} ${t('minUnit')}`;
  } else if (h > 0) {
    return `${h} ${t('hUnit')}`;
  }
  return `${m} ${t('minUnit')}`;
};

const formatPower = (watts: number) => {
  const abs = Math.abs(watts);
  if (abs >= 1000) {
    return `${(abs / 1000).toFixed(1)} ${t('kwUnit')}`;
  }
  return `${abs} ${t('wUnit')}`;
};

// Power balance display for building load
const buildingLoadDisplay = computed(() => {
  const isBlackout = props.stats.isBlackout;
  const battPower = props.stats.totalBatteryPowerW;
  const loadW = props.stats.totalBuildingPowerW;
  const gridW = props.stats.totalGridPowerW;

  // 1. Blackout: grid is dead or battery actively covers the majority of the load
  if (isBlackout || (gridW < 100 && battPower > 100) || (battPower > 500 && battPower >= loadW * 0.5)) {
    return {
      value: `-${formatPower(loadW)}`,
      badge: t('loadModeBattery'),
      textColor: 'text-nordic-terracotta-600',
      badgeClass: 'bg-nordic-terracotta-50 text-nordic-terracotta-700 border-nordic-terracotta-200',
    };
  }

  // 2. Battery charging: surplus grid/solar power actively charging batteries
  if (battPower < -100) {
    const chargeW = Math.abs(battPower);
    return {
      value: `+${formatPower(chargeW)}`,
      badge: t('loadModeCharging'),
      textColor: 'text-nordic-green-600',
      badgeClass: 'bg-nordic-green-50 text-nordic-green-700 border-nordic-green-200',
    };
  }

  // 3. Grid active and supplying load (default when grid > 0)
  return {
    value: formatPower(loadW),
    badge: t('loadModeGrid'),
    textColor: 'text-slate-900',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
  };
});
// Calculate estimated depletion clock time (e.g. "до ~15:00 завтра")
const estimatedEndTimeDisplay = computed(() => {
  const hours = props.stats.estimatedComplexAutonomyHours;
  if (hours === null || hours <= 0) return null;

  const targetDate = new Date(Date.now() + hours * 3600 * 1000);
  const now = new Date();

  const hh = targetDate.getHours().toString().padStart(2, '0');
  const mm = targetDate.getMinutes().toString().padStart(2, '0');
  const timeStr = `${hh}:${mm}`;

  const isSameDay = targetDate.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = targetDate.toDateString() === tomorrow.toDateString();

  if (isSameDay) {
    return t('untilToday', { time: timeStr });
  }
  if (isTomorrow) {
    return t('untilTomorrow', { time: timeStr });
  }

  const d = targetDate.getDate().toString().padStart(2, '0');
  const m = (targetDate.getMonth() + 1).toString().padStart(2, '0');
  return t('untilDate', { time: timeStr, date: `${d}.${m}` });
});
</script>

<template>
  <div class="relative w-full rounded-xl bg-white border border-slate-200/90 p-6 md:p-8 shadow-sm">
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3">
          <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-nordic-green-50 text-nordic-green-700 border border-nordic-green-200 shrink-0">
            <Sparkles class="w-3.5 h-3.5" />
            {{ t('heroBadge') }}
          </span>
          <span 
            class="text-xs text-slate-500 font-medium whitespace-normal sm:whitespace-nowrap transition-opacity duration-300"
            :class="loading && stats.onlineStations === 0 ? 'opacity-0' : 'opacity-100'"
          >
            {{ t('activeStations', { online: stats.onlineStations, total: stats.totalStations }) }}
          </span>
        </div>
        <h1 class="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight mt-2.5 leading-tight min-h-[36px] flex items-center">
          {{ t('heroTitle') }}
        </h1>
      </div>

      <!-- Grid Status (Interactive Clickable Cell) -->
      <button 
        type="button"
        @click="emit('open-complex-outages')"
        @pointerenter="import('@/components/ComplexOutagesModal.vue').catch(() => {})"
        @focus="import('@/components/ComplexOutagesModal.vue').catch(() => {})"
        :title="t('complexOutages.buttonTooltip')"
        class="flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-colors duration-200 shrink-0 w-full md:w-[290px] h-[60px] text-left cursor-pointer group focus:outline-none focus:ring-2 focus:ring-nordic-terracotta-500/20"
        :class="loading && stats.totalBuildingPowerW === 0
          ? 'bg-white border-slate-200 text-slate-400'
          : stats.blackoutStatus === 'full'
            ? 'bg-nordic-terracotta-50 border-nordic-terracotta-200 text-nordic-terracotta-800 hover:border-nordic-terracotta-300 hover:bg-nordic-terracotta-100/60' 
            : stats.blackoutStatus === 'partial'
              ? 'bg-nordic-ochre-50 border-nordic-ochre-200 text-nordic-ochre-700 hover:border-nordic-ochre-300 hover:bg-nordic-ochre-100/60'
              : 'bg-nordic-green-50 border-nordic-green-200 text-nordic-green-800 hover:border-nordic-green-300 hover:bg-nordic-green-100/60'"
      >
        <div 
          class="p-2 rounded-lg shrink-0 transition-colors duration-200"
          :class="loading && stats.totalBuildingPowerW === 0
            ? 'bg-slate-100 text-slate-400'
            : stats.blackoutStatus === 'full'
              ? 'bg-nordic-terracotta-100 text-nordic-terracotta-600' 
              : stats.blackoutStatus === 'partial'
                ? 'bg-nordic-ochre-100 text-nordic-ochre-600'
                : 'bg-nordic-green-100 text-nordic-green-600'"
        >
          <ShieldAlert v-if="!loading && stats.isBlackout" class="w-5 h-5" />
          <CheckCircle v-else class="w-5 h-5" />
        </div>
        <div 
          class="leading-tight transition-opacity duration-300 flex-1 min-w-0"
          :class="loading && stats.totalBuildingPowerW === 0 ? 'opacity-0' : 'opacity-100'"
        >
          <div class="flex items-center justify-between gap-1">
            <span class="block text-xs font-semibold text-slate-500">{{ t('gridStatus') }}</span>
            <span class="text-[10px] font-bold text-slate-400 group-hover:text-slate-600 opacity-80 group-hover:opacity-100 transition-opacity">
              {{ t('complexOutages.chartPill') }} ↗
            </span>
          </div>
          <span class="text-sm font-black whitespace-nowrap block truncate">
            {{ 
              stats.blackoutStatus === 'full' 
                ? (stats.blackoutDurationMinutes && stats.blackoutDurationMinutes > 0 ? t('gridBlackoutWithDuration', { duration: formatDuration(stats.blackoutDurationMinutes) }) : t('gridBlackout'))
                : stats.blackoutStatus === 'partial'
                  ? (stats.blackoutDurationMinutes && stats.blackoutDurationMinutes > 0 ? t('gridPartialBlackoutWithDuration', { duration: formatDuration(stats.blackoutDurationMinutes) }) : t('gridPartialBlackout', { count: stats.blackoutCount, total: stats.onlineStations }))
                  : t('gridNormal') 
            }}
          </span>
        </div>
      </button>
    </div>

    <!-- Key Metrics -->
    <div 
      class="grid gap-3 sm:gap-4 md:gap-6 pt-6"
      :class="stats.totalSolarPowerW > 50 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3'"
    >
      <!-- 1. Battery SoC -->
      <div class="p-3 sm:p-4 rounded-lg bg-slate-50 border border-slate-200/80 flex flex-col justify-between min-h-[126px] h-full box-border overflow-hidden">
        <div>
          <div class="flex items-center gap-1.5 text-slate-500 text-xs font-bold mb-1">
            <Battery class="w-4 h-4 text-nordic-green-600 shrink-0" />
            <span class="truncate">{{ t('avgBattery') }}</span>
          </div>

          <div class="flex items-center min-h-[42px] py-0.5">
            <div v-if="loading && stats.averageBatteryLevel === 0" class="h-7 w-28 rounded-lg bg-slate-200/80 animate-pulse"></div>
            <div v-else class="flex items-baseline gap-1.5 flex-wrap">
              <span class="text-2xl sm:text-3xl font-black text-slate-900 leading-none whitespace-nowrap tabular-nums">
                {{ Math.round(stats.averageBatteryLevel) }}%
              </span>
              <span class="text-[11px] sm:text-xs text-slate-500 font-semibold truncate whitespace-nowrap">
                {{ stats.currentStoredEnergyKwh.toFixed(1) }} / {{ stats.totalBatteryCapacityKwh }} {{ t('kwhUnit') }}
              </span>
            </div>
          </div>
        </div>
        <div class="w-full h-2 rounded-full bg-slate-200 mt-2 overflow-hidden shrink-0">
          <div 
            class="h-full bg-gradient-to-r from-nordic-green-500 to-nordic-green-600 rounded-full transition-all duration-500"
            :style="{ width: `${stats.averageBatteryLevel}%` }"
          ></div>
        </div>
      </div>

      <!-- 2. Autonomy -->
      <div class="p-3 sm:p-4 rounded-lg bg-slate-50 border border-slate-200/80 flex flex-col justify-between min-h-[126px] h-full box-border overflow-hidden">
        <div>
          <div class="flex items-center gap-1.5 text-slate-500 text-xs font-bold mb-1">
            <Clock class="w-4 h-4 text-nordic-ochre-600 shrink-0" />
            <span class="truncate">{{ t('autonomyForecast') }}</span>
          </div>

          <div class="flex items-center min-h-[42px] py-0.5">
            <div v-if="loading && stats.estimatedComplexAutonomyHours === null" class="h-7 w-28 rounded-lg bg-slate-200/80 animate-pulse"></div>
            <div v-else class="flex items-baseline gap-1.5 flex-wrap">
              <span class="text-2xl sm:text-3xl font-black text-slate-900 leading-none whitespace-nowrap tabular-nums">
                {{ stats.estimatedComplexAutonomyHours !== null ? `~${stats.estimatedComplexAutonomyHours}h` : '—' }}
              </span>
              <div class="flex flex-col ml-0.5 leading-tight min-w-0">
                <span class="text-[10px] sm:text-[11px] text-slate-500 font-medium whitespace-nowrap truncate">
                  {{ stats.isBlackout ? t('underDischarge') : t('inReserve') }}
                </span>
                <span 
                  class="text-[9px] sm:text-[10px] text-nordic-ochre-700 font-bold whitespace-nowrap h-[14px] leading-tight transition-opacity duration-300 truncate"
                  :class="estimatedEndTimeDisplay ? 'opacity-100' : 'opacity-0'"
                >
                  {{ estimatedEndTimeDisplay || '—' }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <p class="text-[10px] sm:text-[11px] text-slate-400 mt-1.5 font-medium truncate">
          {{ stats.totalBuildingPowerW > 0 
            ? t('totalCapacityWithLoad', { kwh: stats.totalBatteryCapacityKwh, kw: (stats.totalBuildingPowerW / 1000).toFixed(2) })
            : t('totalCapacity', { kwh: stats.totalBatteryCapacityKwh }) 
          }}
        </p>
      </div>

      <!-- 3. Solar Generation (Only displayed if generation > 0) -->
      <div v-if="stats.totalSolarPowerW > 50" class="p-3 sm:p-4 rounded-lg bg-slate-50 border border-slate-200/80 flex flex-col justify-between min-h-[126px] h-full box-border overflow-hidden">
        <div>
          <div class="flex items-center gap-1.5 text-slate-500 text-xs font-bold mb-1">
            <Sun class="w-4 h-4 text-nordic-ochre-600 shrink-0" />
            <span class="truncate">{{ t('solarGen') }}</span>
          </div>
          <div class="flex items-center min-h-[42px] py-0.5">
            <div v-if="loading && stats.totalSolarPowerW === 0" class="h-7 w-28 rounded-lg bg-slate-200/80 animate-pulse"></div>
            <div v-else class="flex items-baseline gap-1.5 flex-wrap">
              <span class="text-2xl sm:text-3xl font-black text-slate-900 leading-none tabular-nums whitespace-nowrap">
                {{ formatPower(stats.totalSolarPowerW) }}
              </span>
            </div>
          </div>
        </div>
        <p class="text-[10px] sm:text-[11px] text-slate-400 mt-1.5 font-medium truncate">
          {{ t('solarSub') }}
        </p>
      </div>

      <!-- 4. Building Load -->
      <div class="p-3 sm:p-4 rounded-lg bg-slate-50 border border-slate-200/80 flex flex-col justify-between min-h-[126px] h-full box-border overflow-hidden">
        <div>
          <div class="flex items-center gap-1.5 text-slate-500 text-xs font-bold mb-1">
            <Building2 class="w-4 h-4 text-slate-600 shrink-0" />
            <span class="truncate">{{ t('buildingLoad') }}</span>
          </div>

          <div class="flex items-center min-h-[42px] py-0.5">
            <div v-if="loading && stats.totalBuildingPowerW === 0" class="h-7 w-28 rounded-lg bg-slate-200/80 animate-pulse"></div>
            <div v-else class="flex items-baseline gap-1.5 flex-wrap">
              <span class="text-2xl sm:text-3xl font-black leading-none whitespace-nowrap tabular-nums" :class="buildingLoadDisplay.textColor">
                {{ buildingLoadDisplay.value }}
              </span>
              <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-md border whitespace-nowrap shrink-0" :class="buildingLoadDisplay.badgeClass">
                {{ buildingLoadDisplay.badge }}
              </span>
            </div>
          </div>
        </div>
        <p class="text-[10px] sm:text-[11px] text-slate-400 mt-1.5 font-medium truncate">
          {{ t('loadSub') }}
        </p>
      </div>
    </div>
  </div>
</template>
