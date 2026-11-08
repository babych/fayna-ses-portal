<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Sun, Battery, Building2, Zap } from 'lucide-vue-next';
import type { PowerSource, BatteryState } from '@/types/models';

const { t } = useI18n();

defineProps<{
  solarPower: number;
  hasPv?: boolean;
  gridPower: number;
  batteryPower: number;
  buildingPower: number;
  batteryLevel: number;
  batteryState: BatteryState;
  powerSource: PowerSource;
  isStale?: boolean;
  isDrained?: boolean;
  isInitialLoading?: boolean;
}>();

const formatW = (watts: number) => {
  const abs = Math.abs(watts);
  if (abs >= 1000) {
    return `${(abs / 1000).toFixed(2)} ${t('kwUnit')}`;
  }
  return `${abs} ${t('wUnit')}`;
};
</script>

<template>
  <div class="relative w-full rounded-lg bg-slate-50 border border-slate-200 p-4 overflow-hidden">
    <!-- Grid items layout: fixed 3 columns by default, expanding to 4 only when solar generates -->
    <div 
      class="relative z-10 grid gap-2 text-center transition-all duration-300"
      :class="(solarPower > 50 || hasPv) ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'"
    >
      <!-- 1. Solar (Only if generating > 0) -->
      <div v-if="solarPower > 50 || hasPv" class="flex flex-col items-center p-2 rounded-lg bg-white border border-slate-200/80 shadow-xs aspect-square box-border justify-between overflow-hidden">
        <div class="flex flex-col items-center w-full min-w-0">
          <div class="p-1.5 rounded-lg bg-amber-50 text-amber-500 mb-1">
            <Sun class="w-4 h-4" />
          </div>
          <span class="text-[11px] text-slate-500 font-medium whitespace-nowrap truncate max-w-full h-[16px] leading-[16px]">{{ t('solar') }}</span>
        </div>
        <div class="flex items-center justify-center w-full h-[24px]">
          <span class="text-sm font-bold text-slate-800 tabular-nums leading-none">{{ formatW(solarPower) }}</span>
        </div>
      </div>

      <!-- 2. Grid -->
      <div 
        class="flex flex-col items-center p-2 rounded-lg bg-white border shadow-xs transition-all aspect-square box-border justify-between overflow-hidden relative"
        :class="isInitialLoading 
          ? 'border-slate-200/80 bg-white'
          : gridPower > 50 
            ? 'border-sky-300 bg-sky-50/50' 
            : 'border-nordic-terracotta-700/25 bg-nordic-terracotta-700/[0.03]'"
      >
        <div class="flex flex-col items-center w-full min-w-0">
          <div 
            class="p-1.5 rounded-lg mb-1 transition-colors"
            :class="isInitialLoading 
              ? 'bg-slate-100 text-slate-400' 
              : gridPower > 50 
                ? 'bg-sky-50 text-sky-600' 
                : 'bg-nordic-terracotta-700/10 text-nordic-terracotta-700'"
          >
            <Zap class="w-4 h-4" />
          </div>
          <span 
            class="text-[11px] font-medium whitespace-nowrap truncate max-w-full h-[16px] leading-[16px] text-slate-500"
          >
            <template v-if="!isInitialLoading && gridPower <= 20">
              <span class="text-nordic-terracotta-700 font-bold">{{ t('gridBlackout').split(' ')[0] }}</span>
            </template>
            <template v-else>
              {{ t('grid') }}
            </template>
          </span>
        </div>
        <div class="flex items-center justify-center w-full h-[24px]">
          <span 
            class="text-sm font-bold tabular-nums leading-none"
            :class="!isInitialLoading && gridPower <= 50 ? 'text-nordic-terracotta-700 font-black' : 'text-slate-800'"
          >
            {{ isInitialLoading || gridPower <= 0 ? `0 ${t('wUnit')}` : formatW(gridPower) }}
          </span>
        </div>
      </div>

      <!-- 3. Battery -->
      <div 
        class="flex flex-col items-center p-2 rounded-lg bg-white border shadow-xs transition-all aspect-square box-border justify-between overflow-hidden"
        :class="{
          'border-nordic-green-300 bg-nordic-green-50/50': batteryState === 'charging',
          'border-nordic-ochre-300 bg-nordic-ochre-50/50': batteryState === 'discharging',
          'border-slate-200/80': batteryState === 'idle',
        }"
      >
        <div class="flex flex-col items-center w-full min-w-0">
          <div class="p-1.5 rounded-lg bg-nordic-green-50 text-nordic-green-700 mb-1">
            <Battery class="w-4 h-4" />
          </div>
          <span class="text-[11px] text-slate-500 font-medium tabular-nums whitespace-nowrap truncate max-w-full h-[16px] leading-[16px]">
            {{ t('battery') }} ({{ Math.round(batteryLevel) }}%)
          </span>
        </div>
        <div class="flex items-center justify-center w-full h-[24px]">
          <span class="text-sm font-bold text-slate-800 tabular-nums leading-none">
            <template v-if="batteryState === 'charging'">+{{ formatW(batteryPower) }}</template>
            <template v-else-if="batteryState === 'discharging'">-{{ formatW(batteryPower) }}</template>
            <template v-else>0 {{ t('wUnit') }}</template>
          </span>
        </div>
      </div>

      <!-- 4. Load -->
      <div class="flex flex-col items-center p-2 rounded-lg bg-white border border-slate-200/80 shadow-xs aspect-square box-border justify-between overflow-hidden">
        <div class="flex flex-col items-center w-full min-w-0">
          <div class="p-1.5 rounded-lg bg-slate-100 text-slate-700 mb-1">
            <Building2 class="w-4 h-4" />
          </div>
          <span class="text-[11px] text-slate-500 font-medium whitespace-nowrap truncate max-w-full h-[16px] leading-[16px]">{{ t('load') }}</span>
        </div>
        <div class="flex items-center justify-center w-full h-[24px]">
          <span class="text-sm font-bold text-slate-800 tabular-nums leading-none">{{ formatW(buildingPower) }}</span>
        </div>
      </div>
    </div>

    <!-- Dominant Power Mode (Zero-CLS: fixed height with tabular labels) -->
    <div class="mt-3 h-[20px] leading-none flex items-center justify-center gap-1.5 text-[11px] font-semibold text-slate-500">
      <span>{{ t('dominantSource') }}</span>
      <span 
        v-if="isInitialLoading"
        class="inline-flex items-center gap-1 font-extrabold uppercase tracking-wide text-slate-400"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
        —
      </span>
      <span 
        v-else-if="isDrained"
        class="inline-flex items-center gap-1 font-extrabold uppercase tracking-wide text-rose-700"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
        {{ t('sourceDrained') }}
      </span>
      <span 
        v-else-if="isStale"
        class="inline-flex items-center gap-1 font-extrabold uppercase tracking-wide text-nordic-ochre-700"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-nordic-ochre-500 animate-pulse"></span>
        {{ t('sourceOffline') }}
      </span>
      <span 
        v-else
        class="inline-flex items-center gap-1 font-extrabold uppercase tracking-wide text-nordic-green-700"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-nordic-green-500"></span>
        {{ powerSource === 'solar' ? t('sourceSolar') : powerSource === 'grid' ? t('sourceGrid') : powerSource === 'battery' ? t('sourceBattery') : t('sourceIdle') }}
      </span>
    </div>
  </div>
</template>
