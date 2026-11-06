<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowDown, ArrowUp, Pause } from 'lucide-vue-next';
import type { BatteryState } from '@/types/models';

const { t } = useI18n();

const props = defineProps<{
  level: number;
  power: number;
  state: BatteryState;
  capacityKwh: number;
  remainingKwh: number;
  autonomyHours: number | null;
  isInitialLoading?: boolean;
  isDrained?: boolean;
}>();

const batteryColor = computed(() => {
  if (props.level > 50) return 'from-emerald-500 to-emerald-400';
  if (props.level > 20) return 'from-amber-500 to-amber-400';
  return 'from-nordic-terracotta-700 to-nordic-terracotta-500';
});

const batteryBorderColor = computed(() => {
  if (props.level > 50) return 'border-emerald-500/30 text-emerald-600';
  if (props.level > 20) return 'border-amber-500/30 text-amber-600';
  return 'border-nordic-terracotta-700/30 text-nordic-terracotta-700';
});

const formattedPower = computed(() => {
  const abs = Math.abs(props.power);
  if (abs >= 1000) {
    return `${(abs / 1000).toFixed(2)} ${t('kwUnit')}`;
  }
  return `${abs} ${t('wUnit')}`;
});
</script>

<template>
  <div class="flex flex-col items-center">
    <div class="relative flex flex-col items-center">
      <div 
        class="w-8 h-2 rounded-t-sm bg-slate-300 border-t border-x border-slate-300 transition-colors"
        :class="{ 'bg-emerald-500 border-emerald-400': state === 'charging' }"
      ></div>

      <div 
        class="w-28 h-44 rounded-2xl p-1.5 bg-white border-2 shadow-lg shadow-slate-200/50 relative overflow-hidden transition-all duration-500"
        :class="batteryBorderColor"
      >
        <div class="absolute inset-y-2 right-2 flex flex-col justify-between opacity-30 pointer-events-none z-20">
          <span class="w-2 h-0.5 bg-slate-400"></span>
          <span class="w-3 h-0.5 bg-slate-400"></span>
          <span class="w-2 h-0.5 bg-slate-400"></span>
          <span class="w-3 h-0.5 bg-slate-400"></span>
          <span class="w-2 h-0.5 bg-slate-400"></span>
        </div>

        <div class="relative w-full h-full rounded-xl overflow-hidden bg-slate-100 flex flex-col justify-end">
          <div 
            class="w-full bg-gradient-to-t transition-all duration-1000 ease-out relative"
            :class="batteryColor"
            :style="{ height: `${isDrained ? 2 : Math.max(5, Math.min(100, level))}%` }"
          >
            <div 
              v-if="state === 'charging' || state === 'discharging'"
              class="absolute -top-2 left-0 right-0 h-3 bg-white/40 blur-xs rounded-full animate-flow"
            ></div>
          </div>

          <div class="absolute inset-0 flex flex-col items-center justify-center z-10 select-none">
            <span class="h-[32px] leading-none flex items-center justify-center text-2xl font-black tracking-tight drop-shadow-sm tabular-nums" :class="isDrained ? 'text-rose-600' : 'text-slate-900'">
              <template v-if="isInitialLoading">—</template>
              <template v-else-if="isDrained">0%</template>
              <template v-else>{{ Math.round(level) }}%</template>
            </span>
            <span class="h-[16px] leading-none flex items-center justify-center text-[11px] font-bold tabular-nums mt-0.5" :class="isDrained ? 'text-rose-600' : 'text-slate-600'">
              <template v-if="isInitialLoading">— / {{ capacityKwh }} {{ t('kwhUnit') }}</template>
              <template v-else-if="isDrained">0.0 / {{ capacityKwh }} {{ t('kwhUnit') }}</template>
              <template v-else>{{ remainingKwh.toFixed(1) }} / {{ capacityKwh }} {{ t('kwhUnit') }}</template>
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Mode -->
    <div class="mt-3 h-[28px] min-w-[155px] whitespace-nowrap flex items-center justify-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-all"
      :class="{
        'bg-rose-50 text-rose-700 border-rose-200 shadow-sm': isDrained,
        'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm': !isDrained && state === 'charging',
        'bg-amber-50 text-amber-700 border-amber-200 shadow-sm': !isDrained && state === 'discharging',
        'bg-slate-100 text-slate-600 border-slate-200': !isDrained && state === 'idle',
      }"
    >
      <template v-if="isDrained">
        <Pause class="w-3.5 h-3.5 text-rose-500" />
        <span class="tabular-nums">{{ t('drainedStatus') }}</span>
      </template>
      <template v-else>
        <ArrowDown v-if="state === 'charging'" class="w-3.5 h-3.5 animate-bounce" />
        <ArrowUp v-else-if="state === 'discharging'" class="w-3.5 h-3.5 animate-pulse" />
        <Pause v-else class="w-3 h-3 text-slate-400" />

        <span class="tabular-nums">
          <template v-if="state === 'charging'">{{ t('charging') }} +{{ formattedPower }}</template>
          <template v-else-if="state === 'discharging'">{{ t('discharging') }} -{{ formattedPower }}</template>
          <template v-else>{{ t('idle') }}</template>
        </span>
      </template>
    </div>

    <!-- Autonomy forecast reserve slot (Zero-CLS: fixed h-[20px] and whitespace-nowrap prevents card height jumping) -->
    <div class="h-[20px] mt-1 flex items-center justify-center overflow-hidden">
      <div 
        class="text-[11px] font-bold tabular-nums whitespace-nowrap leading-none transition-opacity duration-300"
        :class="[
          isDrained ? 'text-rose-600 opacity-100' : 'text-amber-600',
          !isDrained && autonomyHours !== null ? 'opacity-100' : '',
          !isDrained && autonomyHours === null ? 'opacity-0' : ''
        ]"
      >
        {{ isDrained ? t('drainedAutonomy') : (autonomyHours !== null ? t('hoursAutonomy', { hours: autonomyHours }) : '—') }}
      </div>
    </div>
  </div>
</template>
