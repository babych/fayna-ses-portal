<script setup lang="ts">
import { useTheme } from '@/composables/useTheme';
import { ref, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { X, ChevronRight, Activity, ChevronLeft, Calendar } from 'lucide-vue-next';
import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler,
} from 'chart.js';
import type { StationTelemetry, RawTodayFeed } from '@/types/models';
import { fetchDayHistory } from '@/services/api';
import { useStationI18n } from '@/composables/useStationI18n';

ChartJS.register(
  Title,
  Tooltip,
  Legend,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler
);

const props = withDefaults(defineProps<{
  stations: StationTelemetry[];
  initialDate?: string;
}>(), {
  initialDate: '',
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'select-station', station: StationTelemetry): void;
  (e: 'update:date', date: string): void;
}>();

const { t } = useI18n();
const { isGraphite } = useTheme();
const { getStationName } = useStationI18n();

// Set of hidden station IDs controlled by legend toggles
const hiddenStationIds = ref<Set<string>>(new Set());

const toggleStationVisibility = (id: string) => {
  const next = new Set(hiddenStationIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    // Keep at least one visible
    if (next.size < props.stations.length - 1) {
      next.add(id);
    }
  }
  hiddenStationIds.value = next;
};

// Helpers for dates
function getLocalDateStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeDateStr(str: string): string {
  if (!str) return '';
  // Support DD.MM.YYYY
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
    const [d, m, y] = str.split('.');
    return `${y}-${m}-${d}`;
  }
  return str;
}

const todayDateStr = computed(() => getLocalDateStr());
const selectedDate = ref<string>(normalizeDateStr(props.initialDate) || getLocalDateStr());
const isToday = computed(() => selectedDate.value === todayDateStr.value);

watch(() => props.initialDate, (newDate) => {
  const norm = normalizeDateStr(newDate);
  if (norm && norm !== selectedDate.value) {
    selectedDate.value = norm;
    loadHistoricalData(norm);
  }
});

onMounted(() => {
  const norm = normalizeDateStr(props.initialDate);
  if (norm && norm !== todayDateStr.value) {
    selectedDate.value = norm;
    loadHistoricalData(norm);
  } else if (norm) {
    loadHistoricalData(norm);
  }
});

const formattedSelectedDate = computed(() => {
  if (!selectedDate.value) return '';
  if (isToday.value) return t('history.todayLabel');
  try {
    const [y, m, d] = selectedDate.value.split('-');
    return `${d}.${m}.${y}`;
  } catch {
    return selectedDate.value;
  }
});

// In-memory cache for date feeds to make repeat clicks instant (0ms latency, zero re-fetching)
const dayFeedsCache = new Map<string, Record<string, RawTodayFeed | null>>();

// Storage for historical day feeds when selectedDate != today
const historyFeeds = ref<Record<string, RawTodayFeed | null>>({});
const loadingHistory = ref(false);

const loadHistoricalData = async (dateStr: string) => {
  if (dateStr === todayDateStr.value) return;
  
  // Instant cache hit: render immediately with zero network delay
  if (dayFeedsCache.has(dateStr)) {
    historyFeeds.value = dayFeedsCache.get(dateStr)!;
    return;
  }

  loadingHistory.value = true;
  try {
    const promises = props.stations.map(async (st) => {
      try {
        const feed = await fetchDayHistory(st.id, dateStr);
        return { id: st.id, feed };
      } catch {
        return { id: st.id, feed: null };
      }
    });
    const results = await Promise.all(promises);
    const newMap: Record<string, RawTodayFeed | null> = {};
    for (const r of results) {
      newMap[r.id] = r.feed;
    }
    dayFeedsCache.set(dateStr, newMap);
    historyFeeds.value = newMap;
  } finally {
    loadingHistory.value = false;
  }
};

const navigateDay = async (delta: number) => {
  if (!selectedDate.value) return;
  const current = new Date(selectedDate.value + 'T12:00:00');
  current.setDate(current.getDate() + delta);
  const nextDateStr = getLocalDateStr(current);
  if (nextDateStr > todayDateStr.value) return; // Cannot go to future
  selectedDate.value = nextDateStr;
  emit('update:date', nextDateStr);
  await loadHistoricalData(nextDateStr);
};

const onDatePick = async (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (!target || !target.value) return;
  const picked = target.value;
  if (picked > todayDateStr.value) return;
  selectedDate.value = picked;
  emit('update:date', picked);
  await loadHistoricalData(picked);
};

// Distinctive palette for each building line
const STATION_COLORS = [
  '#2563eb', // Blue (Building 1)
  '#059669', // Emerald (Building 9)
  '#d97706', // Amber (Building 18)
  '#dc2626', // Red (Building 18 Elevator)
  '#7c3aed', // Purple (Building 24)
  '#0891b2', // Cyan (extra)
];

const TIME_STEP_MINUTES = 2;

// X-axis time labels and minute slots
const chartGrid = computed(() => {
  const isSelectedToday = isToday.value;
  let totalMinutes = 24 * 60;
  if (isSelectedToday) {
    const now = new Date();
    totalMinutes = now.getHours() * 60 + now.getMinutes();
  }

  const totalSlots = Math.floor(totalMinutes / TIME_STEP_MINUTES) + 1;
  const timeLabels: string[] = [];
  const minuteOffsets: number[] = [];

  for (let i = 0; i < totalSlots; i++) {
    const m = i * TIME_STEP_MINUTES;
    minuteOffsets.push(m);
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    timeLabels.push(`${hh}:${mm}`);
  }

  return { timeLabels, minuteOffsets, totalSlots };
});

// Build datasets for each station
const datasets = computed(() => {
  const { minuteOffsets, totalSlots } = chartGrid.value;
  const baseMidnight = new Date(selectedDate.value + 'T00:00:00').getTime() / 1000;

  return props.stations.map((st, idx) => {
    const color = STATION_COLORS[idx % STATION_COLORS.length];
    
    // Choose live history if today, or historical day feed
    let timestamps: number[] = [];
    let grid: number[] = [];
    let load: number[] = [];
    let batt: number[] = [];

    if (isToday.value) {
      const feed = st.history;
      timestamps = feed?.timestamps || [];
      grid = feed?.grid || [];
      load = feed?.load || [];
      batt = feed?.batt || [];
    } else {
      const hist = historyFeeds.value[st.id];
      timestamps = hist?.t || [];
      grid = hist?.grid || [];
      load = hist?.load || [];
      batt = hist?.batt || [];
    }

    const baseOffset = idx * 1.35; // Shelf height separation
    const dataPoints: (number | null)[] = [];

    const isStationOffAtTimestamp = (g: number, l: number, b: number) => {
      // Near-zero grid (|g| <= 20W) indicates grid power loss.
      // Negative grid (|g| > 20W with negative sign) is elevator regeneration into city grid.
      return Math.abs(g) <= 20 && (l > 20 || b > 50);
    };

    let pIdx = 0;
    const sampleLen = timestamps.length;

    for (let slot = 0; slot < totalSlots; slot++) {
      const targetMinute = minuteOffsets[slot];
      const targetTs = baseMidnight + targetMinute * 60;

      if (sampleLen === 0 || targetTs < timestamps[0]) {
        dataPoints.push(null);
        continue;
      }

      while (pIdx < sampleLen - 1 && timestamps[pIdx + 1] <= targetTs) {
        pIdx++;
      }

      if (targetTs - timestamps[pIdx] > 45 * 60) {
        dataPoints.push(null);
        continue;
      }

      const g = grid[pIdx] ?? 0;
      const l = load[pIdx] ?? 0;
      const b = batt[pIdx] ?? 0;
      const isOff = isStationOffAtTimestamp(g, l, b);

      const binaryValue = isOff ? 0 : 1;
      dataPoints.push(baseOffset + binaryValue);
    }

    const isHidden = hiddenStationIds.value.has(st.id);
    return {
      label: getStationName(st),
      data: isHidden ? [] : dataPoints,
      hidden: isHidden,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2.2,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHitRadius: 8,
      stepped: 'before' as const,
      tension: 0,
      stationRef: st,
      baseOffset,
    };
  });
});

const chartData = computed(() => ({
  labels: chartGrid.value.timeLabels,
  datasets: datasets.value,
}));

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'nearest' as const,
    axis: 'xy' as const,
    intersect: false,
  },
  animation: false as const,
  plugins: {
    legend: {
      display: false, // Hidden to save space on mobile; bottom station list serves as clear toggle/jump
    },
    tooltip: {
      backgroundColor: '#0f172a',
      titleFont: { size: 12, weight: 700 },
      bodyFont: { size: 11 },
      padding: 8,
      cornerRadius: 10,
      displayColors: true,
      filter: (item: any, index: number) => {
        // Strict single-item guarantee: display ONLY the closest item
        return index === 0;
      },
      callbacks: {
        title: (items: any[]) => {
          if (!items.length) return '';
          return `${t('complexOutages.time')}: ${items[0].label}`;
        },
        label: (context: any) => {
          const ds = context.dataset;
          const val = context.raw;
          if (val === null || val === undefined) return `${ds.label}: —`;
          const isGridOn = (val - ds.baseOffset) >= 0.5;
          return `${ds.label}: ${isGridOn ? '🟢 220V' : '🔴 ' + t('complexOutages.blackout')}`;
        },
      },
    },
  },
  scales: {
    x: {
      grid: {
        display: true,
        color: isGraphite.value ? 'rgba(59, 67, 82, 0.4)' : 'rgba(226, 232, 240, 0.6)',
      },
      ticks: {
        maxTicksLimit: 12,
        font: { size: 10 },
        color: isGraphite.value ? '#9aa3b0' : '#64748b',
      },
    },
    y: {
      display: true,
      grid: {
        display: true,
        color: isGraphite.value ? 'rgba(59, 67, 82, 0.4)' : 'rgba(241, 245, 249, 0.8)',
      },
      ticks: {
        display: false,
      },
      min: -0.2,
      max: (props.stations.length - 1) * 1.35 + 1.2,
    },
  },
}));
</script>

<template>
  <div 
    @click.self="emit('close')"
    class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
  >
    <div class="relative w-full max-w-4xl max-h-[92vh] bg-white rounded-3xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
      <!-- Modal Header -->
      <div class="px-5 py-3.5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/70 shrink-0">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-nordic-terracotta-50 border border-nordic-terracotta-200 text-nordic-terracotta-600 flex items-center justify-center shrink-0">
            <Activity class="w-5 h-5" />
          </div>
          <div>
            <h2 class="text-base sm:text-lg font-black text-slate-900 leading-tight">
              {{ t('complexOutages.modalTitle') }}
            </h2>
            <p class="text-xs text-slate-500 font-medium">
              {{ t('complexOutages.modalSubtitle') }}
            </p>
          </div>
        </div>

        <div class="flex items-center justify-between sm:justify-end gap-2.5">
          <!-- Calendar Date Picker Bar -->
          <div class="flex items-center justify-between px-2 py-1 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 h-[38px] box-border shrink-0 shadow-xs">
            <button 
              @click="navigateDay(-1)"
              :title="t('history.prevDay')"
              class="p-1 rounded-lg hover:bg-slate-100 hover:text-slate-900 transition-colors shrink-0"
              :disabled="loadingHistory"
            >
              <ChevronLeft class="w-4 h-4" />
            </button>
            
            <label 
              class="relative flex items-center justify-center gap-1.5 px-2 cursor-pointer hover:text-slate-900 group whitespace-nowrap min-w-[105px]"
            >
              <Calendar class="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 transition-colors pointer-events-none shrink-0" />
              <span class="font-bold text-slate-800 border-b border-dashed border-slate-300 group-hover:border-slate-600 pb-0.5 pointer-events-none whitespace-nowrap">
                {{ formattedSelectedDate }}
              </span>
              <input 
                type="date"
                :value="selectedDate"
                :max="todayDateStr"
                @change="onDatePick"
                class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
            </label>

            <button 
              @click="navigateDay(1)"
              :title="t('history.nextDay')"
              class="p-1 rounded-lg transition-colors shrink-0"
              :class="isToday ? 'opacity-30 cursor-not-allowed text-slate-300' : 'hover:bg-slate-100 hover:text-slate-900'"
              :disabled="isToday || loadingHistory"
            >
              <ChevronRight class="w-4 h-4" />
            </button>
          </div>

          <button 
            @click="emit('close')"
            class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            :aria-label="t('close')"
          >
            <X class="w-5 h-5" />
          </button>
        </div>
      </div>

      <!-- Content Area -->
      <div class="p-4 sm:p-6 overflow-y-auto flex-1 flex flex-col gap-4">
        <!-- Legend Guide Bar -->
        <div class="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs">
          <div class="flex items-center gap-4">
            <div class="flex items-center gap-1.5 font-bold text-slate-700">
              <span class="w-2.5 h-2.5 rounded-full bg-nordic-green-600"></span>
              {{ t('complexOutages.legend220v') }}
            </div>
            <div class="flex items-center gap-1.5 font-bold text-nordic-terracotta-700">
              <span class="w-2.5 h-2.5 rounded-full bg-nordic-terracotta-500"></span>
              {{ t('complexOutages.legendBlackout') }}
            </div>
          </div>
          <span class="text-slate-400 text-[11px] font-medium hidden sm:inline">
            {{ t('complexOutages.steppedTip') }}
          </span>
        </div>

        <!-- Multi-Track Stepped Chart with Smooth Fade Transition (No intrusive blocking spinner) -->
        <div class="w-full h-[320px] sm:h-[380px] p-1 sm:p-2 bg-white rounded-2xl border border-slate-100 relative">
          <div :class="loadingHistory ? 'opacity-40 transition-opacity duration-150' : 'opacity-100 transition-opacity duration-150'" class="w-full h-full">
            <Line :data="chartData" :options="chartOptions" />
          </div>
        </div>

        <!-- Quick Jump to Station & Track Toggle -->
        <div class="mt-1">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-bold text-slate-600 block">
              {{ t('complexOutages.stationsOverview') }}
            </span>
            <span class="text-[10px] text-slate-400 font-medium">
              {{ t('complexOutages.tapToOpen') }}
            </span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            <div
              v-for="(st, idx) in stations"
              :key="st.id"
              class="flex items-center justify-between p-2 rounded-xl border transition-all"
              :class="hiddenStationIds.has(st.id) ? 'border-slate-100 bg-slate-50/50 opacity-50' : 'border-slate-200 bg-white hover:border-slate-300'"
            >
              <!-- Toggle Visibility Button -->
              <button
                type="button"
                @click.stop="toggleStationVisibility(st.id)"
                class="flex items-center gap-2 min-w-0 flex-1 py-1 px-1 text-left cursor-pointer"
                :title="hiddenStationIds.has(st.id) ? t('complexOutages.showLine') : t('complexOutages.hideLine')"
              >
                <span 
                  class="w-3.5 h-3.5 rounded-full shrink-0 transition-transform" 
                  :class="{ 'scale-75 opacity-40': hiddenStationIds.has(st.id) }"
                  :style="{ backgroundColor: STATION_COLORS[idx % STATION_COLORS.length] }"
                ></span>
                <span 
                  class="text-xs font-bold truncate transition-colors"
                  :class="hiddenStationIds.has(st.id) ? 'line-through text-slate-400' : 'text-slate-800'"
                >
                  {{ getStationName(st) }}
                </span>
              </button>

              <!-- Jump to Station Details Button -->
              <button
                type="button"
                @click="emit('select-station', st)"
                class="p-1 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors shrink-0 ml-1"
                :title="t('analytics')"
              >
                <ChevronRight class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
