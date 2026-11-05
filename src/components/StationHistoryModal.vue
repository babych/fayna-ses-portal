<script setup lang="ts">
import { useTheme } from '@/composables/useTheme';
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { X, AlertCircle, AlertTriangle, CheckCircle, Clock, ChevronLeft, ChevronRight, Calendar } from 'lucide-vue-next';
import { Line, Bar } from 'vue-chartjs';
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  LineElement,
  BarElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler,
} from 'chart.js';

import type { StationTelemetry, RawTodayFeed } from '@/types/models';
import { fetchMonthHistory, fetchDayHistory, fetchTodayFeed } from '@/services/api';
import { useStationI18n } from '@/composables/useStationI18n';
import {
  computeBlackoutIntervals,
  computePowerIntervals,
  computeHourlyBlackoutMinutes,
  type BlackoutInterval,
  type PowerInterval,
  type HourlyBlackoutLevel,
  type HourlyBlackoutStat,
} from '@/utils/blackout';

ChartJS.register(
  Title,
  Tooltip,
  Legend,
  LineElement,
  BarElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler
);

const { t } = useI18n();
const { isGraphite } = useTheme();
const { getStationName, getStationDesc } = useStationI18n();

const props = withDefaults(defineProps<{
  station: StationTelemetry | null;
  isOpen: boolean;
  initialTab?: 'telemetry' | 'day' | 'blackouts' | 'month';
  initialDate?: string;
  initialMonth?: string;
  initialSubtab?: 'day' | 'month';
  canGoBackToTrends?: boolean;
}>(), {
  initialTab: 'day',
  initialDate: '',
  initialMonth: '',
  initialSubtab: 'day',
  canGoBackToTrends: false,
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'back-to-trends'): void;
  (e: 'update:tab', tab: string): void;
  (e: 'update:date', date: string): void;
  (e: 'update:month', month: string): void;
  (e: 'update:subtab', subtab: string): void;
}>();

const mode = ref<'day' | 'blackouts'>(
  props.initialTab === 'blackouts' || props.initialTab === 'month' ? 'blackouts' : 'day'
);
const blackoutSubTab = ref<'day' | 'month'>(
  props.initialTab === 'month' || props.initialSubtab === 'month' ? 'month' : 'day'
);
const loading = ref(false);
const monthHistory = ref<any>(null);
const errorMessage = ref<string | null>(null);

function getLocalDateStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getLocalMonthStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// Fast in-memory caches to make date navigation instantaneous (0ms network delay, zero INP presentation lag)
const singleDayFeedsCache = new Map<string, RawTodayFeed | null>();
const singleMonthDataCache = new Map<string, any>();

// Selected date for day view navigation (always initialized to local today)
const selectedDate = ref<string>(props.initialDate || getLocalDateStr()); // YYYY-MM-DD
const selectedDayFeed = ref<RawTodayFeed | null>(null);
const isHistoryDay = computed(() => {
  if (!selectedDate.value) return false;
  return selectedDate.value !== getLocalDateStr();
});

// Selected month for month view navigation (always initialized to local month)
const selectedMonth = ref<string>(props.initialMonth || getLocalMonthStr()); // YYYY-MM

const initSelectedDates = () => {
  selectedDate.value = props.initialDate || getLocalDateStr();
  selectedMonth.value = props.initialMonth || getLocalMonthStr();
  selectedDayFeed.value = null;
};

const loadDayData = async (dateStr: string) => {
  if (!props.station) return;
  const todayStr = getLocalDateStr();
  if (dateStr === todayStr) {
    selectedDayFeed.value = null; // Use live props.station.history
    return;
  }

  const cacheKey = `${props.station.id}:${dateStr}`;
  if (singleDayFeedsCache.has(cacheKey)) {
    selectedDayFeed.value = singleDayFeedsCache.get(cacheKey)!;
    return;
  }

  loading.value = true;
  errorMessage.value = null;
  try {
    const feed = await fetchDayHistory(props.station.id, dateStr);
    singleDayFeedsCache.set(cacheKey, feed);
    selectedDayFeed.value = feed;
  } catch (err) {
    errorMessage.value = 'Failed to load day history.';
    selectedDayFeed.value = null;
  } finally {
    loading.value = false;
  }
};

const navigateDay = async (delta: number) => {
  if (!selectedDate.value) return;
  const current = new Date(selectedDate.value + 'T12:00:00');
  current.setDate(current.getDate() + delta);
  const nextDateStr = getLocalDateStr(current);
  const todayStr = getLocalDateStr();
  if (nextDateStr > todayStr) return; // Cannot go to future
  selectedDate.value = nextDateStr;
  emit('update:date', nextDateStr);
  await loadDayData(nextDateStr);
};

const loadMonthData = async (monthStr: string) => {
  if (!props.station) return;
  const cacheKey = `${props.station.id}:${monthStr}`;
  if (singleMonthDataCache.has(cacheKey)) {
    monthHistory.value = singleMonthDataCache.get(cacheKey);
    return;
  }

  loading.value = true;
  errorMessage.value = null;
  try {
    const data = await fetchMonthHistory(props.station.id, monthStr).catch(() => null);
    if (data && data.days) {
      singleMonthDataCache.set(cacheKey, data);
      monthHistory.value = data;
    } else {
      // Month fallback strategy: if upstream month archive is missing on the current month
      // (common on the 1st day of a new month before data is compiled), fall back to previous month
      if (monthStr === getLocalMonthStr()) {
        loading.value = false;
        await navigateMonth(-1);
        return;
      }
      monthHistory.value = null;
      errorMessage.value = 'Data unavailable for this month.';
    }
  } catch (err) {
    if (monthStr === getLocalMonthStr()) {
      loading.value = false;
      await navigateMonth(-1);
      return;
    }
    errorMessage.value = 'Failed to load month data.';
    monthHistory.value = null;
  } finally {
    loading.value = false;
  }
};

// Earliest supported month in the historical database
const MIN_SUPPORTED_MONTH = '2025-02';

const isEarliestMonth = computed(() => {
  return selectedMonth.value <= MIN_SUPPORTED_MONTH;
});

const navigateMonth = async (delta: number) => {
  if (!selectedMonth.value) return;
  if (delta < 0 && isEarliestMonth.value) return; // Locked: no data prior to 2025-02

  const [yearStr, monthPart] = selectedMonth.value.split('-');
  let y = parseInt(yearStr, 10);
  let m = parseInt(monthPart, 10) - 1 + delta;
  if (m < 0) {
    m = 11;
    y -= 1;
  } else if (m > 11) {
    m = 0;
    y += 1;
  }
  const nextMonthStr = `${y}-${(m + 1).toString().padStart(2, '0')}`;
  const nowMonth = getLocalMonthStr();
  if (nextMonthStr > nowMonth) return; // Cannot go to future
  if (nextMonthStr < MIN_SUPPORTED_MONTH) return; // Cannot go prior to min supported

  selectedMonth.value = nextMonthStr;
  emit('update:month', nextMonthStr);
  await loadMonthData(nextMonthStr);
};

const todayDateStr = computed(() => {
  return getLocalDateStr();
});

const currentMonthDateStr = computed(() => {
  return getLocalMonthStr();
});

const isToday = computed(() => {
  return selectedDate.value === getLocalDateStr();
});

const dateInputRef = ref<HTMLInputElement | null>(null);
const monthInputRef = ref<HTMLInputElement | null>(null);

const triggerDatePicker = () => {
  if (dateInputRef.value) {
    if (typeof dateInputRef.value.showPicker === 'function') {
      dateInputRef.value.showPicker();
    } else {
      dateInputRef.value.focus();
      dateInputRef.value.click();
    }
  }
};

const triggerMonthPicker = () => {
  if (monthInputRef.value) {
    if (typeof monthInputRef.value.showPicker === 'function') {
      monthInputRef.value.showPicker();
    } else {
      monthInputRef.value.focus();
      monthInputRef.value.click();
    }
  }
};

const isCurrentMonth = computed(() => {
  const currentMonthStr = getLocalMonthStr();
  return selectedMonth.value === currentMonthStr;
});

const onDatePick = async (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (!target || !target.value) return;
  const picked = target.value;
  const today = todayDateStr.value;
  if (picked > today) return;
  selectedDate.value = picked;
  emit('update:date', picked);
  await loadDayData(picked);
};

const onMonthPick = async (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (!target || !target.value) return;
  const picked = target.value;
  const curMonth = currentMonthDateStr.value;
  if (picked > curMonth) return;
  if (picked < MIN_SUPPORTED_MONTH) return;
  selectedMonth.value = picked;
  emit('update:month', picked);
  await loadMonthData(picked);
};

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

const loadData = async () => {
  if (!props.station) return;
  errorMessage.value = null;

  if (!selectedDate.value) initSelectedDates();

  if (mode.value === 'blackouts' && blackoutSubTab.value === 'month') {
    await loadMonthData(selectedMonth.value);
  } else if (isHistoryDay.value && !selectedDayFeed.value) {
    await loadDayData(selectedDate.value);
  }
};

watch(() => props.station, (newStation) => {
  if (newStation && props.isOpen) {
    loadData();
  }
});


watch(() => props.initialTab, (newTab) => {
  if (newTab) {
    if (newTab === 'month') {
      mode.value = 'blackouts';
      blackoutSubTab.value = 'month';
    } else {
      mode.value = newTab === 'blackouts' ? 'blackouts' : 'day';
    }
  }
});

watch(() => props.initialSubtab, (newSubtab) => {
  if (newSubtab && (newSubtab === 'day' || newSubtab === 'month')) {
    if (blackoutSubTab.value !== newSubtab) blackoutSubTab.value = newSubtab;
  }
});

watch(() => props.initialDate, (newDate) => {
  if (newDate && newDate !== selectedDate.value) {
    selectedDate.value = newDate;
    loadDayData(newDate);
  }
});

watch(() => props.initialMonth, (newMonth) => {
  if (newMonth && newMonth !== selectedMonth.value) {
    selectedMonth.value = newMonth;
    loadMonthData(newMonth);
  }
});

watch(() => props.isOpen, (open) => {
  if (open) {
    initSelectedDates();
    if (props.initialTab) {
      if (props.initialTab === 'month') {
        mode.value = 'blackouts';
        blackoutSubTab.value = 'month';
      } else {
        mode.value = props.initialTab === 'blackouts' ? 'blackouts' : 'day';
      }
    }
    if (props.initialSubtab) {
      blackoutSubTab.value = props.initialSubtab;
    }
    loadData();
  }
});

watch([mode, blackoutSubTab], ([newMode, newSubtab]) => {
  emit('update:tab', newMode === 'day' ? 'telemetry' : newMode);
  if (newMode === 'blackouts') {
    emit('update:subtab', newSubtab);
  }
  loadData();
});

// Blackout types are imported from @/utils/blackout

const activeDayFeed = computed(() => {
  if (selectedDayFeed.value) {
    return {
      timestamps: selectedDayFeed.value.t || [],
      soc: selectedDayFeed.value.soc || [],
      grid: selectedDayFeed.value.grid || [],
      load: selectedDayFeed.value.load || [],
      pv: selectedDayFeed.value.pv || [],
      batt: selectedDayFeed.value.batt || [],
    };
  }
  return props.station?.history || null;
});

const dayBlackoutData = computed(() => {
  const feed = activeDayFeed.value;
  if (!feed || !feed.timestamps || feed.timestamps.length === 0) {
    return {
      intervals: [] as BlackoutInterval[],
      totalMinutes: 0,
      hourlyLevels: Array(24).fill('none') as HourlyBlackoutLevel[],
      hourlyMinutes: Array(24).fill(0) as number[],
      hourlyStats: Array(24).fill({ level: 'none', minutes: 0, percent: 0, tooltipText: '' }) as HourlyBlackoutStat[],
    };
  }

  const { timestamps, grid, load, batt } = feed;
  const intervals = computeBlackoutIntervals(timestamps, grid, load, isHistoryDay.value, batt);
  const powerIntervals = computePowerIntervals(timestamps, grid, load, isHistoryDay.value, batt, 'power');
  const totalMinutes = intervals.reduce((acc, curr) => acc + curr.durationMinutes, 0);
  const hourlyMinutes = computeHourlyBlackoutMinutes(intervals);

  // Determine current hour from telemetry timestamp or local time
  const lastTs = timestamps.length > 0 ? timestamps[timestamps.length - 1] : Math.floor(Date.now() / 1000);
  const currentTelemetryHour = isHistoryDay.value ? 24 : new Date(lastTs * 1000).getHours();

  // Hourly stats with exact percentage of outage and detailed tooltip
  const hourlyStats: HourlyBlackoutStat[] = hourlyMinutes.map((m, h) => {
    if (h > currentTelemetryHour) {
      return { 
        level: 'future', 
        minutes: 0, 
        percent: 0, 
        tooltipText: `${h}:00 — ${t('history.futureHours')}` 
      };
    }
    const percent = Math.min(100, Math.round((m / 60) * 100));
    let level: HourlyBlackoutLevel = 'none';
    if (m >= 55) level = 'full';
    else if (m > 0) level = 'partial';

    // Find intervals overlapping with this hour
    const matchingIntervals = intervals.filter(it => {
      const sH = it.start.getHours();
      const eH = it.end.getHours();
      return h >= sH && h <= eH;
    });

    const isOngoingInThisHour = matchingIntervals.some(it => it.isOngoing && h === currentTelemetryHour);

    // Overlapping power intervals (for Light ON tooltip)
    const matchingPower = powerIntervals.filter(it => {
      const sH = it.start.getHours();
      const eH = it.end.getHours();
      return h >= sH && h <= eH;
    });

    let tooltipText = '';
    if (matchingIntervals.length > 0 && level !== 'none') {
      // Overlapping continuous blackout interval(s)
      const parts = matchingIntervals.map(it => {
        const startStr = formatTimeRange(it.start);
        const endStr = it.isOngoing ? t('history.ongoing') : formatTimeRange(it.end);
        const durStr = formatDuration(it.durationMinutes);
        return `🔴 ${startStr} — ${endStr} (${durStr})`;
      });
      tooltipText = parts.join(' | ');
    } else if (matchingPower.length > 0) {
      // Overlapping continuous light interval(s)
      const parts = matchingPower.map(it => {
        const startStr = formatTimeRange(it.start);
        const endStr = it.isOngoing ? t('history.ongoing') : formatTimeRange(it.end);
        const durStr = formatDuration(it.durationMinutes);
        return `🟢 ${startStr} — ${endStr} (${durStr})`;
      });
      tooltipText = parts.join(' | ');
    } else if (m === 0) {
      tooltipText = `${h}:00–${h + 1}:00: ${t('history.tooltipNoOutage')}`;
    } else {
      tooltipText = `${h}:00–${h + 1}:00`;
    }

    return {
      level,
      minutes: m,
      percent,
      isOngoing: isOngoingInThisHour,
      tooltipText,
      matchingOutage: matchingIntervals[0],
      matchingPower: matchingPower[0],
    };
  });

  const hourlyLevels: HourlyBlackoutLevel[] = hourlyStats.map(s => s.level);

  return { intervals: intervals.reverse(), totalMinutes, hourlyLevels, hourlyMinutes, hourlyStats };
});

// Monthly chart
const monthBlackoutChartData = computed(() => {
  if (!monthHistory.value || !monthHistory.value.days) {
    return { labels: [], datasets: [] };
  }

  const days = monthHistory.value.days;
  const gridArr = monthHistory.value.grid || [];
  const loadArr = monthHistory.value.load || [];

  const blackoutBatteryKwh = days.map((_: number, idx: number) => {
    const l = loadArr[idx] || 0;
    const g = gridArr[idx] || 0;
    return Math.max(0, Math.round((l - g) * 10) / 10);
  });

  return {
    labels: days.map((d: number) => `${d}`),
    datasets: [
      {
        label: t('history.blackoutBatteryEnergy'),
        data: blackoutBatteryKwh,
        backgroundColor: '#B91C1C',
        borderRadius: 4,
        maxBarThickness: 24,
      },
      {
        label: t('history.chartMonthGrid'),
        data: gridArr,
        backgroundColor: '#0284c7',
        borderRadius: 4,
        maxBarThickness: 24,
      },
    ],
  };
});

const monthBlackoutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove', 'touchend'] as any,
  plugins: {
    legend: { labels: { color: '#1e293b', font: { family: 'Plus Jakarta Sans', weight: 'bold' as const }, usePointStyle: true } },
  },
  scales: {
    x: { grid: { color: '#f1f5f9' }, ticks: { color: '#64748b' } },
    y: {
      grid: { color: '#f1f5f9' },
      ticks: { color: '#64748b' },
      title: { display: true, text: t('kwhUnit'), color: '#64748b' },
    },
  },
};

const formatTimeRange = (d: Date) => {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
};

const formatFullDateTime = (d: Date) => {
  const day = d.getDate();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = monthNames[d.getMonth()] || '';
  const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  return `${day} ${monthName}, ${time}`;
};

const formatDuration = (totalMinutes: number) => {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) {
    return `${h} ${t('hUnit')} ${m} ${t('minUnit')}`;
  } else if (h > 0) {
    return `${h} ${t('hUnit')}`;
  }
  return `${m} ${t('minUnit')}`;
};

// Continuous Monthly Grid Matrix
export interface MonthGridHourCell {
  day: number;
  hour: number;
  status: 'on' | 'off' | 'partial' | 'nodata';
  offMinutes: number;
  percent: number;
  dateStr: string;
  tooltipText?: string;
}

export interface ContinuousPowerEvent {
  isOff: boolean;
  start: Date;
  end: Date;
  durationMinutes: number;
}

const isMonthGridLoading = ref(false);
const monthGridFeeds = ref<Map<string, RawTodayFeed | null>>(new Map());
const selectedMatrixEvent = ref<{
  type: 'on' | 'off' | 'partial' | 'nodata';
  day: number;
  hour: number;
  startStr: string;
  endStr: string;
  durationStr: string;
  crossesMidnight: boolean;
} | null>(null);

const hoveredMatrixCell = ref<MonthGridHourCell | null>(null);

const activeDailyHourDetail = ref<{
  hour: number;
  stat: HourlyBlackoutStat;
} | null>(null);

const toggleDailyHourDetail = (hour: number, stat: HourlyBlackoutStat) => {
  if (activeDailyHourDetail.value && activeDailyHourDetail.value.hour === hour) {
    activeDailyHourDetail.value = null;
  } else {
    activeDailyHourDetail.value = { hour, stat };
  }
};

let monthGridReqId = 0;
const monthFeedsCache = new Map<string, Map<string, RawTodayFeed | null>>();

const loadMonthGridFeeds = async (monthStr: string) => {
  if (!props.station) return;
  const isSelectedCurrentMonth = monthStr === getLocalMonthStr();
  const cacheKey = `${props.station.id}:${monthStr}`;
  if (!isSelectedCurrentMonth && monthFeedsCache.has(cacheKey)) {
    monthGridFeeds.value = monthFeedsCache.get(cacheKey)!;
    isMonthGridLoading.value = false;
    return;
  }

  const currentReqId = ++monthGridReqId;
  isMonthGridLoading.value = true;
  try {
    const [yStr, mStr] = monthStr.split('-');
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);
    const daysInMonth = new Date(year, month, 0).getDate();
    const todayStr = getLocalDateStr();

    const fetchPromises: Promise<[string, RawTodayFeed | null]>[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (dStr > todayStr) continue; // Skip future dates

      if (dStr === todayStr) {
        if (props.station.history && props.station.history.timestamps.length > 0) {
          const h = props.station.history;
          const syntheticFeed: RawTodayFeed = {
            date: dStr,
            updated: Math.floor(Date.now() / 1000),
            status: 'NORMAL',
            t: h.timestamps,
            soc: h.soc,
            pv: h.pv,
            grid: h.grid,
            batt: h.batt,
            load: h.load,
          };
          fetchPromises.push(Promise.resolve([dStr, syntheticFeed]));
        } else {
          // If station.history is not populated in props, fetch today.json directly
          fetchPromises.push(
            fetchTodayFeed(props.station.id)
              .then((feed): [string, RawTodayFeed | null] => [dStr, feed])
              .catch((): [string, RawTodayFeed | null] => [dStr, null])
          );
        }
      } else {
        fetchPromises.push(
          fetchDayHistory(props.station.id, dStr)
            .then((feed): [string, RawTodayFeed | null] => [dStr, feed])
            .catch((): [string, RawTodayFeed | null] => [dStr, null])
        );
      }
    }

    const entries = await Promise.all(fetchPromises);
    if (currentReqId !== monthGridReqId) return;

    const map = new Map<string, RawTodayFeed | null>();
    for (const [dStr, feed] of entries) {
      map.set(dStr, feed);
    }
    if (!isSelectedCurrentMonth) {
      monthFeedsCache.set(cacheKey, map);
    }
    monthGridFeeds.value = map;
  } catch (err) {
    console.error('Failed to load month grid feeds:', err);
  } finally {
    if (currentReqId === monthGridReqId) {
      isMonthGridLoading.value = false;
    }
  }
};

// Compute continuous events across days
const monthContinuousEvents = computed<ContinuousPowerEvent[]>(() => {
  const map = monthGridFeeds.value;
  if (!map || map.size === 0) return [];

  const allPoints: { t: number; isOff: boolean }[] = [];
  const sortedDates = Array.from(map.keys()).sort();

  for (const dStr of sortedDates) {
    const feed = map.get(dStr);
    if (!feed || !feed.t || feed.t.length === 0) continue;
    for (let i = 0; i < feed.t.length; i++) {
      if (feed.t[i] === null || (feed.grid[i] === null && feed.load[i] === null)) continue;
      const g = feed.grid[i] ?? 0;
      const l = feed.load[i] ?? 0;
      const b = feed.batt[i] ?? 0;
      const isOff = Math.abs(g) <= 20 && (l > 20 || b > 50);
      allPoints.push({ t: feed.t[i], isOff });
    }
  }

  const events: ContinuousPowerEvent[] = [];
  let cur: { isOff: boolean; start: number; end: number } | null = null;

  for (let i = 0; i < allPoints.length; i++) {
    const p = allPoints[i];
    if (!cur) {
      cur = { isOff: p.isOff, start: p.t, end: p.t };
    } else if (cur.isOff === p.isOff && (p.t - cur.end) <= 45 * 60) {
      cur.end = p.t;
    } else {
      events.push({
        isOff: cur.isOff,
        start: new Date(cur.start * 1000),
        end: new Date(cur.end * 1000),
        durationMinutes: Math.max(1, Math.round((cur.end - cur.start) / 60)),
      });
      cur = { isOff: p.isOff, start: p.t, end: p.t };
    }
  }

  if (cur) {
    events.push({
      isOff: cur.isOff,
      start: new Date(cur.start * 1000),
      end: new Date(cur.end * 1000),
      durationMinutes: Math.max(1, Math.round((cur.end - cur.start) / 60)),
    });
  }

  return events;
});

// Build 24-hour rows by day for the matrix
const monthGridMatrix = computed(() => {
  const map = monthGridFeeds.value;
  const [yStr, mStr] = selectedMonth.value.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayStr = getLocalDateStr();

  const days: { day: number; dateStr: string; hours: MonthGridHourCell[] }[] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const feed = map.get(dStr);
    const hours: MonthGridHourCell[] = [];

    if (!feed || !feed.t || feed.t.length === 0) {
      for (let h = 0; h < 24; h++) {
        hours.push({
          day: d,
          hour: h,
          status: 'nodata',
          offMinutes: 0,
          percent: 0,
          dateStr: dStr,
        });
      }
    } else {
      for (let h = 0; h < 24; h++) {
        let offCount = 0;
        let onCount = 0;
        for (let i = 0; i < feed.t.length; i++) {
          const ptHour = new Date(feed.t[i] * 1000).getHours();
          if (ptHour === h) {
            const g = feed.grid[i] ?? 0;
            const l = feed.load[i] ?? 0;
            const b = feed.batt[i] ?? 0;
            const isOff = Math.abs(g) <= 20 && (l > 20 || b > 50);
            if (isOff) offCount++;
            else onCount++;
          }
        }

        const cellStatus: 'nodata' | 'off' | 'on' | 'partial' = 
          (offCount === 0 && onCount === 0) ? 'nodata' :
          (offCount > 0 && onCount === 0) ? 'off' :
          (offCount === 0 && onCount > 0) ? 'on' : 'partial';

        const total = offCount + onCount;
        const offMin = total > 0 ? Math.round((offCount / total) * 60) : 0;
        const pct = total > 0 ? Math.round((offCount / total) * 100) : 0;

        // Find continuous interval covering this hour timestamp for instant hover tooltip
        let tooltip = `${dStr} ${h}:00`;
        if (cellStatus !== 'nodata') {
          if (cellStatus === 'partial') {
            const onMin = Math.max(0, 60 - offMin);
            tooltip = `🟡 ${h}:00–${h + 1}:00 • 🔴 ${offMin} ${t('minUnit')} | 🟢 ${onMin} ${t('minUnit')}`;
          } else {
            const targetTs = new Date(year, month - 1, d, h, 30).getTime() / 1000;
            const hourStart = new Date(year, month - 1, d, h, 0).getTime() / 1000;
            const hourEnd = new Date(year, month - 1, d, h + 1, 0).getTime() / 1000;

            const isCellOff = cellStatus === 'off';
            // First check if a continuous event strictly encompasses targetTs
            let match = monthContinuousEvents.value.find(it => {
              if (it.isOff !== isCellOff) return false;
              const s = Math.floor(it.start.getTime() / 1000);
              const e = Math.floor(it.end.getTime() / 1000);
              return targetTs >= s && targetTs <= e;
            });

            // Fallback: check if continuous event overlaps this hour
            if (!match) {
              match = monthContinuousEvents.value.find(it => {
                if (it.isOff !== isCellOff) return false;
                const s = Math.floor(it.start.getTime() / 1000);
                const e = Math.floor(it.end.getTime() / 1000);
                return s < hourEnd && e > hourStart;
              });
            }

            if (match) {
              const icon = match.isOff ? '🔴' : '🟢';
              const dur = formatDuration(match.durationMinutes);
              const startFmt = formatFullDateTime(match.start);
              const endFmt = formatFullDateTime(match.end);
              tooltip = `${icon} ${startFmt} — ${endFmt} (${dur})`;
            } else if (cellStatus === 'off') {
              tooltip = `🔴 ${h}:00 — ${h + 1}:00 (60 ${t('minUnit')})`;
            } else if (cellStatus === 'on') {
              tooltip = `🟢 ${h}:00 — ${h + 1}:00 (60 ${t('minUnit')})`;
            }
          }
        }

        hours.push({
          day: d,
          hour: h,
          status: cellStatus,
          offMinutes: offMin,
          percent: pct,
          dateStr: dStr,
          tooltipText: tooltip,
        });
      }
    }

    days.push({ day: d, dateStr: dStr, hours });
  }

  return days;
});

const handleMatrixCellClick = (cell: MonthGridHourCell) => {
  if (cell.status === 'nodata') {
    selectedMatrixEvent.value = {
      type: 'nodata',
      day: cell.day,
      hour: cell.hour,
      startStr: `${cell.hour}:00`,
      endStr: `${cell.hour + 1}:00`,
      durationStr: t('history.matrixNoData'),
      crossesMidnight: false,
    };
    return;
  }

  // If it's a partial hour, present the breakdown of off vs on minutes
  if (cell.status === 'partial') {
    const onMin = Math.max(0, 60 - cell.offMinutes);
    selectedMatrixEvent.value = {
      type: 'partial',
      day: cell.day,
      hour: cell.hour,
      startStr: `${cell.hour}:00`,
      endStr: `${cell.hour + 1}:00`,
      durationStr: `🔴 ${cell.offMinutes} ${t('minUnit')} | 🟢 ${onMin} ${t('minUnit')}`,
      crossesMidnight: false,
    };
    return;
  }

  // Find continuous interval covering this hour timestamp
  const [yStr, mStr] = cell.dateStr.split('-');
  const targetTs = new Date(parseInt(yStr, 10), parseInt(mStr, 10) - 1, cell.day, cell.hour, 30).getTime() / 1000;
  const match = monthContinuousEvents.value.find(it => {
    const s = Math.floor(it.start.getTime() / 1000);
    const e = Math.floor(it.end.getTime() / 1000);
    return targetTs >= s && targetTs <= e;
  });

  if (match) {
    const crosses = match.start.toDateString() !== match.end.toDateString();
    selectedMatrixEvent.value = {
      type: match.isOff ? 'off' : 'on',
      day: cell.day,
      hour: cell.hour,
      startStr: formatFullDateTime(match.start),
      endStr: formatFullDateTime(match.end),
      durationStr: formatDuration(match.durationMinutes),
      crossesMidnight: crosses,
    };
  } else {
    selectedMatrixEvent.value = {
      type: cell.status,
      day: cell.day,
      hour: cell.hour,
      startStr: `${cell.hour}:00`,
      endStr: `${cell.hour + 1}:00`,
      durationStr: cell.status === 'off' ? '60 min' : (cell.status === 'on' ? '60 min' : `${cell.offMinutes} min off`),
      crossesMidnight: false,
    };
  }
};

watch([selectedMonth, blackoutSubTab, mode], ([newMonth, subTab, currentMode]) => {
  if (currentMode === 'blackouts' && subTab === 'month') {
    loadMonthGridFeeds(newMonth);
    loadMonthData(newMonth);
  }
}, { immediate: true });

// Daily chart
const dayChartData = computed(() => {
  const feed = activeDayFeed.value;
  if (!feed || !feed.timestamps || feed.timestamps.length === 0) {
    return { labels: [], datasets: [] };
  }

  const timestamps = feed.timestamps;
  const labels: string[] = [];
  const socData: number[] = [];
  const gridData: number[] = [];
  const loadData: number[] = [];

  const step = Math.max(1, Math.floor(timestamps.length / 80));

  for (let i = 0; i < timestamps.length; i += step) {
    const d = new Date(timestamps[i] * 1000);
    labels.push(`${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`);
    socData.push(feed.soc[i] ?? 0);
    gridData.push(feed.grid[i] ?? 0);
    loadData.push(feed.load[i] ?? 0);
  }

  // Always ensure the very latest telemetry sample is included on the chart
  const lastIndex = timestamps.length - 1;
  if (lastIndex >= 0 && (lastIndex % step) !== 0) {
    const d = new Date(timestamps[lastIndex] * 1000);
    labels.push(`${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`);
    socData.push(feed.soc[lastIndex] ?? 0);
    gridData.push(feed.grid[lastIndex] ?? 0);
    loadData.push(feed.load[lastIndex] ?? 0);
  }

  return {
    labels,
    datasets: [
      {
        label: t('history.chartSoc'),
        data: socData,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
        yAxisID: 'ySoc',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2.5,
      },
      {
        label: t('history.chartLoad'),
        data: loadData,
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.05)',
        yAxisID: 'yPower',
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2,
      },
      {
        label: t('history.chartGrid'),
        data: gridData,
        borderColor: '#0284c7',
        backgroundColor: 'rgba(2, 132, 199, 0.05)',
        yAxisID: 'yPower',
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 1.5,
      },
    ],
  };
});

const dayChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove', 'touchend'] as any,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: {
      position: 'top' as const,
      labels: {
        color: isGraphite.value ? '#f0f2f5' : '#1e293b',
        font: { family: 'Plus Jakarta Sans', weight: 'bold' as const, size: 12 },
        usePointStyle: true,
      },
    },
    tooltip: {
      backgroundColor: isGraphite.value ? '#1f232b' : '#ffffff',
      titleColor: isGraphite.value ? '#f0f2f5' : '#0f172a',
      bodyColor: isGraphite.value ? '#c5cbd5' : '#334155',
      borderColor: isGraphite.value ? '#3b4352' : '#e2e8f0',
      borderWidth: 1,
      padding: 10,
    },
  },
  scales: {
    x: { 
      grid: { color: isGraphite.value ? 'rgba(59, 67, 82, 0.4)' : '#f1f5f9' }, 
      ticks: { color: isGraphite.value ? '#9aa3b0' : '#64748b' } 
    },
    ySoc: {
      type: 'linear' as const,
      position: 'left' as const,
      min: 0,
      max: 100,
      ticks: { color: isGraphite.value ? '#27ae60' : '#10b981' },
      grid: { color: isGraphite.value ? 'rgba(59, 67, 82, 0.4)' : '#f1f5f9' },
    },
    yPower: {
      type: 'linear' as const,
      position: 'right' as const,
      ticks: { color: isGraphite.value ? '#a78bfa' : '#8b5cf6' },
      grid: { drawOnChartArea: false },
    },
  },
}));

// Monthly chart
const monthChartData = computed(() => {
  if (!monthHistory.value || !monthHistory.value.days) {
    return { labels: [], datasets: [] };
  }
  const days = monthHistory.value.days;
  const loadArr = monthHistory.value.load || [];
  const gridArr = monthHistory.value.grid || [];
  const pvArr = monthHistory.value.pv || [];

  const batteryArr = days.map((_: number, idx: number) => {
    const l = loadArr[idx] || 0;
    const g = gridArr[idx] || 0;
    return Math.max(0, Math.round((l - g) * 10) / 10);
  });

  const datasets: any[] = [
    {
      label: t('history.chartMonthLoad'),
      data: loadArr,
      backgroundColor: '#8b5cf6',
      borderRadius: 4,
      maxBarThickness: 24,
    },
    {
      label: t('history.chartMonthGrid'),
      data: gridArr,
      backgroundColor: '#0284c7',
      borderRadius: 4,
      maxBarThickness: 24,
    },
    {
      label: t('history.totalMonthBattery'),
      data: batteryArr,
      backgroundColor: '#B91C1C',
      borderRadius: 4,
      maxBarThickness: 24,
    },
  ];

  // Only include PV bar if there is solar energy in the month
  if (pvArr.some((v: number) => (v || 0) > 0)) {
    datasets.push({
      label: `PV (${t('kwhUnit')})`,
      data: pvArr,
      backgroundColor: '#f59e0b',
      borderRadius: 4,
      maxBarThickness: 24,
    });
  }

  return {
    labels: days.map((d: number) => `${d}`),
    datasets,
  };
});

// Monthly totals
const monthTotals = computed(() => {
  if (!monthHistory.value) {
    return { load: 0, grid: 0, pv: 0, blackoutBattery: 0 };
  }
  const loadArr: number[] = monthHistory.value.load || [];
  const gridArr: number[] = monthHistory.value.grid || [];
  const pvArr: number[] = monthHistory.value.pv || [];

  const totalLoad = Math.round(loadArr.reduce((sum, v) => sum + (v || 0), 0) * 10) / 10;
  const totalGrid = Math.round(gridArr.reduce((sum, v) => sum + (v || 0), 0) * 10) / 10;
  const totalPv = Math.round(pvArr.reduce((sum, v) => sum + (v || 0), 0) * 10) / 10;

  // Battery energy supplied to building load (sum of max(0, load - grid))
  let batterySupplied = 0;
  for (let i = 0; i < loadArr.length; i++) {
    const l = loadArr[i] || 0;
    const g = gridArr[i] || 0;
    batterySupplied += Math.max(0, l - g);
  }
  batterySupplied = Math.round(batterySupplied * 10) / 10;

  return {
    load: totalLoad,
    grid: totalGrid,
    pv: totalPv,
    battery: batterySupplied,
    blackoutBattery: batterySupplied,
  };
});

const monthChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove', 'touchend'] as any,
  plugins: {
    legend: { labels: { color: isGraphite.value ? '#f0f2f5' : '#1e293b', font: { family: 'Plus Jakarta Sans', weight: 'bold' as const } } },
  },
  scales: {
    x: { 
      grid: { color: isGraphite.value ? 'rgba(59, 67, 82, 0.4)' : '#f1f5f9' }, 
      ticks: { color: isGraphite.value ? '#9aa3b0' : '#64748b' } 
    },
    y: { 
      grid: { color: isGraphite.value ? 'rgba(59, 67, 82, 0.4)' : '#f1f5f9' }, 
      ticks: { color: isGraphite.value ? '#9aa3b0' : '#64748b' } 
    },
  },
}));

// Metrics for the selected day (live today vs historical day)
const selectedDayMetrics = computed(() => {
  if (!props.station) return null;
  if (!isHistoryDay.value || !selectedDayFeed.value) {
    // Current day: return live telemetry properties
    return {
      batteryLevel: Math.round(props.station.batteryLevel),
      remainingEnergyKwh: Math.round(props.station.remainingEnergyKwh * 10) / 10,
      peakLoadW: props.station.peakLoadW,
      consumedKwh: props.station.buildingEnergyTodayKwh,
      gridKwh: props.station.gridEnergyTodayKwh,
      pvPowerStr: props.station.pvKw > 0 ? `${props.station.pvKw} ${t('kwUnit')}` : t('history.notInstalled'),
    };
  }

  // Historical day: compute metrics from selectedDayFeed
  const feed = selectedDayFeed.value;
  const socArr = feed.soc || [];
  const loadArr = feed.load || [];
  const battCap = props.station.batteryKwh || 0;

  const lastSoc = socArr.length > 0 ? Math.round(socArr[socArr.length - 1]) : 0;
  const remainingEnergyKwh = Math.round((lastSoc / 100) * battCap * 10) / 10;
  const peakLoadW = loadArr.length > 0 ? Math.max(...loadArr) : 0;

  // Day totals from day object or array approximations
  const consumedKwh = feed.day?.load ?? 0;
  const gridKwh = feed.day?.grid ?? 0;
  const pvPowerStr = props.station.pvKw > 0 ? `${props.station.pvKw} ${t('kwUnit')}` : t('history.notInstalled');

  return {
    batteryLevel: lastSoc,
    remainingEnergyKwh,
    peakLoadW,
    consumedKwh,
    gridKwh,
    pvPowerStr,
  };
});
</script>

<template>
  <div 
    v-if="isOpen && station"
    @click.self="emit('close')"
    class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/40 backdrop-blur-md animate-fade-in"
  >
    <div class="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
      <!-- Fixed Header -->
      <div class="p-4 sm:p-8 pb-4 sm:pb-5 border-b border-slate-100 shrink-0">
        <button 
          @click="emit('close')"
          class="absolute top-4 right-4 sm:top-6 sm:right-6 p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors z-10"
        >
          <X class="w-5 h-5" />
        </button>

        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pr-8">
          <div>
            <div class="flex items-center gap-2">
              <button
                v-if="canGoBackToTrends"
                type="button"
                @click="emit('back-to-trends')"
                class="flex items-center gap-1 text-xs font-bold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded-lg transition-colors"
              >
                <ChevronLeft class="w-3.5 h-3.5" />
                <span>{{ t('complexOutages.backToTrends') }}</span>
              </button>
              <span v-else class="text-xs font-bold text-emerald-600 uppercase tracking-wider">{{ t('history.title') }}</span>
            </div>
            <h2 class="text-xl sm:text-2xl font-extrabold text-slate-900 mt-0.5">{{ getStationName(station) }}</h2>
            <p class="text-xs text-slate-500 mt-0.5">{{ getStationDesc(station) }}</p>
          </div>

          <div class="flex flex-col sm:flex-row sm:items-center gap-2.5 self-stretch lg:self-auto w-full lg:w-auto shrink-0">
            <!-- Historical Navigation Bar -->
            <div 
              v-if="mode === 'day' || (mode === 'blackouts' && blackoutSubTab === 'day')"
              class="flex items-center justify-between px-2 py-1 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 h-[38px] box-border shrink-0"
            >
              <button 
                @click="navigateDay(-1)"
                :title="t('history.prevDay')"
                class="p-1 rounded-lg hover:bg-white hover:text-slate-900 transition-colors shrink-0"
                :disabled="loading"
              >
                <ChevronLeft class="w-4 h-4" />
              </button>
              
              <label 
                class="relative flex items-center justify-center gap-1.5 px-2 cursor-pointer hover:text-slate-900 group whitespace-nowrap min-w-[110px]"
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
                :class="isToday ? 'opacity-30 cursor-not-allowed text-slate-300' : 'hover:bg-white hover:text-slate-900'"
                :disabled="isToday || loading"
              >
                <ChevronRight class="w-4 h-4" />
              </button>
            </div>

            <div 
              v-else-if="mode === 'blackouts' && blackoutSubTab === 'month'"
              class="flex items-center justify-between px-2 py-1 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 h-[38px] box-border shrink-0"
            >
              <button 
                @click="navigateMonth(-1)"
                :title="t('history.prevMonth')"
                class="p-1 rounded-lg transition-colors shrink-0"
                :class="isEarliestMonth ? 'opacity-30 cursor-not-allowed text-slate-300' : 'hover:bg-white hover:text-slate-900'"
                :disabled="isEarliestMonth || loading"
              >
                <ChevronLeft class="w-4 h-4" />
              </button>
              
              <label 
                class="relative flex items-center justify-center gap-1.5 px-2 cursor-pointer hover:text-slate-900 group whitespace-nowrap min-w-[90px]"
              >
                <Calendar class="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 transition-colors pointer-events-none shrink-0" />
                <span class="font-bold text-slate-800 border-b border-dashed border-slate-300 group-hover:border-slate-600 pb-0.5 pointer-events-none whitespace-nowrap">
                  {{ selectedMonth }}
                </span>
                <input 
                  type="month"
                  :value="selectedMonth"
                  :min="MIN_SUPPORTED_MONTH"
                  :max="currentMonthDateStr"
                  @change="onMonthPick"
                  class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
              </label>

              <button 
                @click="navigateMonth(1)"
                :title="t('history.nextMonth')"
                class="p-1 rounded-lg transition-colors shrink-0"
                :class="isCurrentMonth ? 'opacity-30 cursor-not-allowed text-slate-300' : 'hover:bg-white hover:text-slate-900'"
                :disabled="isCurrentMonth || loading"
              >
                <ChevronRight class="w-4 h-4" />
              </button>
            </div>

            <!-- Mode Switcher (2 clean tabs: Day & Blackouts/Grid) -->
            <div class="grid grid-cols-2 p-1 rounded-xl bg-slate-100 border border-slate-200 h-[40px] box-border gap-1 w-full sm:w-auto shrink-0">
              <button
                @click="mode = 'day'"
                class="px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition-all text-center truncate"
                :class="mode === 'day' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'"
              >
                {{ t('history.dayTab') }}
              </button>
              <button
                @click="mode = 'blackouts'"
                class="px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition-all text-center truncate"
                :class="mode === 'blackouts' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'"
              >
                {{ t('history.blackoutsTab') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Scrollable Content -->
      <div class="px-3 sm:px-8 py-2 overflow-y-auto flex-1 modal-scroll">

      <!-- CONTENT: 1. Daily Telemetry -->
      <div v-if="mode === 'day'" class="py-2 sm:py-4 flex flex-col gap-5">
        <div class="h-[280px] sm:h-[400px] w-full">
          <Line :data="dayChartData" :options="dayChartOptions" />
        </div>

        <!-- Inline Day Metrics Summary (Scrolls naturally with content instead of pushing chart offscreen) -->
        <div v-if="selectedDayMetrics" class="space-y-3 pt-3 border-t border-slate-100">
          <!-- Equipment Specs Block -->
          <div 
            class="grid gap-2.5"
            :class="station.pvKw > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3'"
          >
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
              <div>
                <span class="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{{ t('history.inverter') }}</span>
                <span class="text-sm font-extrabold text-slate-800">{{ station.inverterKw > 0 ? `${station.inverterKw} ${t('kwUnit')}` : '—' }}</span>
              </div>
              <span v-if="station.inverterKw > 0" class="text-[10px] font-bold px-1.5 py-0.5 rounded" :class="station.inverterLoadPercent > 70 ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'">
                {{ station.inverterLoadPercent }}%
              </span>
            </div>

            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
              <div>
                <span class="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{{ t('history.storedEnergy') }}</span>
                <span class="text-sm font-extrabold text-emerald-700">{{ selectedDayMetrics.remainingEnergyKwh }} {{ t('kwhUnit') }}</span>
              </div>
              <span class="text-[10px] font-bold text-slate-400">/ {{ station.batteryKwh }}</span>
            </div>

            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span class="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{{ t('history.peakLoadToday') }}</span>
              <span class="text-sm font-extrabold text-purple-700">{{ selectedDayMetrics.peakLoadW }} {{ t('wUnit') }}</span>
            </div>

            <div v-if="station.pvKw > 0" class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span class="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{{ t('history.pvPower') }}</span>
              <span class="text-sm font-extrabold text-amber-600">{{ selectedDayMetrics.pvPowerStr }}</span>
            </div>
          </div>

          <!-- Main Daily Metrics -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
            <div class="p-3 rounded-2xl bg-slate-50 border border-slate-100 text-center">
              <span class="block text-[11px] font-semibold text-slate-400">{{ t('history.currentSoc') }}</span>
              <span class="text-lg font-black text-emerald-600 mt-0.5">{{ selectedDayMetrics.batteryLevel }}%</span>
            </div>
            <div class="p-3 rounded-2xl bg-slate-50 border border-slate-100 text-center">
              <span class="block text-[11px] font-semibold text-slate-400">{{ t('history.batteryCapacity') }}</span>
              <span class="text-lg font-black text-slate-800 mt-0.5">{{ station.batteryKwh }} {{ t('kwhUnit') }}</span>
            </div>
            <div class="p-3 rounded-2xl bg-slate-50 border border-slate-100 text-center">
              <span class="block text-[11px] font-semibold text-slate-400">{{ t('history.consumedToday') }}</span>
              <span class="text-lg font-black text-purple-600 mt-0.5">{{ selectedDayMetrics.consumedKwh }} {{ t('kwhUnit') }}</span>
            </div>
            <div class="p-3 rounded-2xl bg-slate-50 border border-slate-100 text-center">
              <span class="block text-[11px] font-semibold text-slate-400">{{ t('history.gridToday') }}</span>
              <span class="text-lg font-black text-sky-600 mt-0.5">{{ selectedDayMetrics.gridKwh }} {{ t('kwhUnit') }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- CONTENT: 2. Blackout Analytics -->
      <div v-else-if="mode === 'blackouts'" class="py-5 space-y-6 flex-1">
        <div class="flex items-center justify-between pb-2 border-b border-slate-100">
          <span class="text-sm font-extrabold text-slate-900">{{ blackoutSubTab === 'month' ? t('history.blackoutsMonthTitle') : t('history.blackoutsTitle') }}</span>

          <div class="flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200">
            <button
              @click="blackoutSubTab = 'day'"
              class="px-3 py-1 rounded-lg text-xs font-bold transition-all"
              :class="blackoutSubTab === 'day' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'"
            >
              {{ t('history.blackoutDayView') }}
            </button>
            <button
              @click="blackoutSubTab = 'month'"
              class="px-3 py-1 rounded-lg text-xs font-bold transition-all"
              :class="blackoutSubTab === 'month' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'"
            >
              {{ t('history.blackoutMonthView') }}
            </button>
          </div>
        </div>

        <!-- DAILY BLACKOUT VIEW -->
        <template v-if="blackoutSubTab === 'day'">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="p-4 rounded-2xl bg-nordic-terracotta-50 border border-nordic-terracotta-100 flex items-center gap-4">
              <div class="p-3 rounded-xl bg-nordic-terracotta-100 text-nordic-terracotta-600">
                <Clock class="w-6 h-6" />
              </div>
              <div>
                <span class="text-xs font-bold text-slate-500 block">{{ t('history.totalBlackoutTime') }}</span>
                <span class="text-2xl font-black text-nordic-terracotta-700">
                  {{ Math.floor(dayBlackoutData.totalMinutes / 60) }}h {{ dayBlackoutData.totalMinutes % 60 }}m
                </span>
              </div>
            </div>

            <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center gap-4">
              <div class="p-3 rounded-xl bg-slate-200 text-slate-700">
                <AlertTriangle class="w-6 h-6" />
              </div>
              <div>
                <span class="text-xs font-bold text-slate-500 block">{{ t('history.blackoutCount') }}</span>
                <span class="text-2xl font-black text-slate-800">
                  {{ dayBlackoutData.intervals.length }} {{ t('history.times') }}
                </span>
              </div>
            </div>
          </div>

          <!-- 24-hour timeline with exact percentage blackout fill -->
          <div class="p-3 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-1">
              <span class="text-xs font-bold text-slate-700 block">{{ t('history.timeline24h') }}</span>
              <span class="text-[10px] sm:text-[11px] text-slate-400 font-semibold leading-tight">{{ t('history.exactPercentDesc') }}</span>
            </div>

            <div class="grid grid-cols-6 sm:grid-cols-12 lg:grid-cols-24 gap-1.5 sm:gap-1">
              <div 
                v-for="hour in 24" 
                :key="hour"
                @click="toggleDailyHourDetail(hour - 1, dayBlackoutData.hourlyStats[hour - 1])"
                class="aspect-square sm:aspect-auto sm:h-11 rounded-xl sm:rounded-md flex flex-col items-center justify-between py-1 sm:py-1 transition-all overflow-visible border relative group/cell cursor-pointer shadow-xs select-none"
                :class="{
                  'ring-2 ring-slate-900 ring-offset-1': activeDailyHourDetail && activeDailyHourDetail.hour === hour - 1,
                  'border-nordic-terracotta-600 text-white font-bold shadow-sm': dayBlackoutData.hourlyStats[hour - 1].level === 'full',
                  'border-nordic-ochre-300 text-slate-900 font-bold': dayBlackoutData.hourlyStats[hour - 1].level === 'partial',
                  'bg-nordic-green-100 text-nordic-green-800 border-nordic-green-200/60 font-semibold': dayBlackoutData.hourlyStats[hour - 1].level === 'none',
                  'bg-slate-100/70 text-slate-400 border-dashed border-slate-200 font-medium': dayBlackoutData.hourlyStats[hour - 1].level === 'future',
                }"
                :style="dayBlackoutData.hourlyStats[hour - 1].level === 'partial' ? {
                  background: dayBlackoutData.hourlyStats[hour - 1].isOngoing
                    ? `linear-gradient(to top, #B91C1C 0%, #B91C1C ${dayBlackoutData.hourlyStats[hour - 1].percent}%, #f1f5f9 ${dayBlackoutData.hourlyStats[hour - 1].percent}%, #f1f5f9 100%)`
                    : `linear-gradient(to top, #B91C1C 0%, #B91C1C ${dayBlackoutData.hourlyStats[hour - 1].percent}%, #DCFCE7 ${dayBlackoutData.hourlyStats[hour - 1].percent}%, #DCFCE7 100%)`
                } : dayBlackoutData.hourlyStats[hour - 1].level === 'full' ? {
                  background: '#B91C1C'
                } : {}"
              >
                <!-- CSS Hover Popup for instant feedback on hover -->
                <div class="pointer-events-none absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover/cell:flex flex-col items-center z-50 whitespace-nowrap">
                  <div class="px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-semibold shadow-xl border border-slate-700/60">
                    {{ dayBlackoutData.hourlyStats[hour - 1].tooltipText }}
                  </div>
                  <div class="w-1.5 h-1.5 bg-slate-900 rotate-45 -mt-0.5 border-r border-b border-slate-700/60"></div>
                </div>

                <span class="text-[10px] sm:text-[9px] font-bold leading-none z-10">{{ hour - 1 }}:00</span>
                <span class="text-[9px] sm:text-[8px] font-black uppercase leading-none drop-shadow-xs z-10">
                  {{ 
                    dayBlackoutData.hourlyStats[hour - 1].level === 'full' ? t('history.badgeBatt') : 
                    dayBlackoutData.hourlyStats[hour - 1].level === 'partial' ? (dayBlackoutData.hourlyStats[hour - 1].isOngoing ? '—' : `${dayBlackoutData.hourlyStats[hour - 1].minutes}${t('minUnit')}`) : 
                    dayBlackoutData.hourlyStats[hour - 1].level === 'future' ? '—' : t('history.badgeGrid') 
                  }}
                </span>
              </div>
            </div>

            <!-- Active Clicked Hour Detail Card (Mobile tap friendly) -->
            <div 
              v-if="activeDailyHourDetail" 
              class="mt-3 p-3 rounded-xl bg-white border border-slate-200/90 shadow-sm flex items-center justify-between text-xs animate-in fade-in duration-200"
            >
              <div class="flex items-center gap-2">
                <span 
                  class="w-2.5 h-2.5 rounded-full shrink-0"
                  :class="{
                    'bg-nordic-terracotta-700': activeDailyHourDetail.stat.level === 'full',
                    'bg-nordic-ochre-500': activeDailyHourDetail.stat.level === 'partial',
                    'bg-nordic-green-600': activeDailyHourDetail.stat.level === 'none',
                    'bg-slate-300': activeDailyHourDetail.stat.level === 'future',
                  }"
                ></span>
                <span class="font-bold text-slate-800">{{ activeDailyHourDetail.stat.tooltipText }}</span>
              </div>
              <button 
                @click="activeDailyHourDetail = null" 
                class="text-slate-400 hover:text-slate-600 p-1 -mr-1"
                aria-label="Close detail"
              >
                <X class="w-3.5 h-3.5" />
              </button>
            </div>

            <!-- Legend with dynamic percentage gradient -->
            <div class="flex flex-wrap items-center justify-between text-[11px] text-slate-500 mt-3 pt-3 border-t border-slate-200/80 gap-2">
              <div class="flex items-center gap-1.5">
                <span class="w-3 h-3 rounded bg-nordic-green-100 border border-nordic-green-300"></span>
                <span>{{ t('history.legendGrid') }}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="w-3 h-3 rounded bg-gradient-to-t from-nordic-terracotta-700 from-50% to-nordic-green-100 to-50% border border-nordic-ochre-300"></span>
                <span class="font-bold text-nordic-ochre-700">{{ t('history.exactOutageFill') }}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="w-3 h-3 rounded bg-nordic-terracotta-700 border border-nordic-terracotta-800"></span>
                <span>{{ t('history.legendBatt') }}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="w-3 h-3 rounded bg-slate-100 border border-dashed border-slate-300"></span>
                <span>{{ t('history.futureHours') }}</span>
              </div>
            </div>
          </div>

          <!-- Outage Intervals Log -->
          <div>
            <span class="text-xs font-bold text-slate-700 block mb-3">{{ t('history.periodsLog') }}</span>
            <div v-if="dayBlackoutData.intervals.length === 0" class="p-6 rounded-2xl bg-emerald-50 border border-emerald-100 text-center text-emerald-800 text-xs font-semibold flex items-center justify-center gap-2">
              <CheckCircle class="w-4 h-4 text-emerald-600" />
              <span>{{ t('history.noBlackoutsToday') }}</span>
            </div>
            <div v-else class="space-y-2">
              <div 
                v-for="(item, idx) in dayBlackoutData.intervals" 
                :key="idx"
                class="p-3.5 rounded-xl bg-white border border-slate-200 flex items-center justify-between text-xs shadow-xs"
              >
                <div class="flex items-center gap-3">
                  <span class="w-2.5 h-2.5 rounded-full bg-nordic-terracotta-700"></span>
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="font-extrabold text-slate-900 text-sm">
                        {{ formatTimeRange(item.start) }} — {{ item.isOngoing ? t('history.ongoing') : formatTimeRange(item.end) }}
                      </span>
                    </div>
                    <span class="block text-[11px] text-slate-400 mt-0.5">{{ t('history.poweredByBatt') }}</span>
                  </div>
                </div>
                <span class="px-2.5 py-1 rounded-full bg-nordic-terracotta-50 text-nordic-terracotta-700 font-bold border border-nordic-terracotta-200">
                  {{ formatDuration(item.durationMinutes) }}
                </span>
              </div>
            </div>
          </div>
        </template>

        <!-- MONTHLY BLACKOUT VIEW -->
        <template v-else>
          <div class="space-y-4">
            <!-- Monthly Summary Cards for Blackouts (4 metrics in grid) -->
            <div 
              class="grid gap-3"
              :class="monthTotals.pv > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3'"
            >
              <div class="p-3.5 rounded-2xl bg-nordic-terracotta-50 border border-nordic-terracotta-100 flex flex-col justify-center">
                <span class="text-[11px] font-bold text-nordic-terracotta-600 block uppercase tracking-wider">{{ t('history.totalMonthBattery') }}</span>
                <span class="text-xl sm:text-2xl font-black text-nordic-terracotta-700 mt-0.5">
                  {{ monthTotals.battery }} <span class="text-xs font-bold text-nordic-terracotta-500">{{ t('kwhUnit') }}</span>
                </span>
              </div>
              <div class="p-3.5 rounded-2xl bg-purple-50 border border-purple-100 flex flex-col justify-center">
                <span class="text-[11px] font-bold text-purple-600 block uppercase tracking-wider">{{ t('history.totalMonthLoad') }}</span>
                <span class="text-xl sm:text-2xl font-black text-purple-700 mt-0.5">
                  {{ monthTotals.load }} <span class="text-xs font-bold text-purple-500">{{ t('kwhUnit') }}</span>
                </span>
              </div>
              <div class="p-3.5 rounded-2xl bg-sky-50 border border-sky-100 flex flex-col justify-center">
                <span class="text-[11px] font-bold text-sky-600 block uppercase tracking-wider">{{ t('history.totalMonthGrid') }}</span>
                <span class="text-xl sm:text-2xl font-black text-sky-700 mt-0.5">
                  {{ monthTotals.grid }} <span class="text-xs font-bold text-sky-500">{{ t('kwhUnit') }}</span>
                </span>
              </div>
              <div v-if="monthTotals.pv > 0" class="p-3.5 rounded-2xl bg-amber-50 border border-amber-100 flex flex-col justify-center">
                <span class="text-[11px] font-bold text-amber-600 block uppercase tracking-wider">{{ t('history.totalMonthPv') }}</span>
                <span class="text-xl sm:text-2xl font-black text-amber-700 mt-0.5">
                  {{ monthTotals.pv }} <span class="text-xs font-bold text-amber-500">{{ t('kwhUnit') }}</span>
                </span>
              </div>
            </div>

            <!-- Continuous Monthly Grid Heatmap Matrix -->
            <div class="p-3 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between mb-2 gap-1">
                <div>
                  <span class="text-xs font-bold text-slate-800 block">{{ t('history.monthlyMatrixTitle') }}</span>
                  <span class="text-[10px] sm:text-[11px] text-slate-400 font-medium leading-tight">
                    {{ t('history.monthlyMatrixSub') }}
                  </span>
                </div>

                <div class="flex items-center gap-2">
                  <div v-if="isMonthGridLoading" class="flex items-center gap-1.5 text-xs text-amber-600 font-bold animate-pulse">
                    <div class="w-2 h-2 rounded-full bg-amber-500"></div>
                    <span>{{ t('history.matrixLoading') }}</span>
                  </div>
                </div>
              </div>

              <!-- Matrix Grid: Days (rows) x 24 Hours (cols) -->
              <div class="overflow-x-auto pb-4 pt-1 px-2">
                <div class="w-fit min-w-full flex flex-col items-center sm:items-start pr-2">
                  <!-- Hour Headers 00 to 23 -->
                  <div class="flex items-center text-[9px] font-bold text-slate-400 mb-1 pl-7 gap-0.5 sm:gap-1">
                    <div 
                      v-for="h in 24" 
                      :key="h" 
                      class="w-3.5 sm:w-4 text-center shrink-0"
                    >
                      <span v-if="(h - 1) % 4 === 0">{{ (h - 1).toString().padStart(2, '0') }}</span>
                      <span v-else class="text-slate-300">·</span>
                    </div>
                  </div>

                  <!-- Days rows -->
                  <div class="space-y-1">
                    <div 
                      v-for="row in monthGridMatrix" 
                      :key="row.day"
                      class="flex items-center gap-1 relative"
                      :class="hoveredMatrixCell && hoveredMatrixCell.day === row.day ? 'z-40' : 'z-0'"
                    >
                      <!-- Day label -->
                      <span class="w-6 text-[10px] font-bold text-slate-500 tabular-nums text-right shrink-0">
                        {{ row.day }}
                      </span>

                      <!-- 24 hourly dots/cells -->
                      <div 
                        class="flex items-center gap-0.5 sm:gap-1"
                        @mouseleave="hoveredMatrixCell = null"
                      >
                        <button
                          v-for="cell in row.hours"
                          :key="cell.hour"
                          @mouseenter="hoveredMatrixCell = cell"
                          @click="handleMatrixCellClick(cell)"
                          type="button"
                          class="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-[3px] aspect-square shrink-0 select-none focus:outline-none relative"
                          :class="{
                            'bg-[#16A34A] hover:brightness-110': cell.status === 'on',
                            'bg-nordic-terracotta-700 hover:brightness-110': cell.status === 'off',
                            'bg-[#D97706] hover:brightness-110': cell.status === 'partial',
                            'bg-slate-200/60 hover:bg-slate-300/80': cell.status === 'nodata',
                            'ring-2 ring-slate-900 ring-offset-1 z-10': selectedMatrixEvent && selectedMatrixEvent.day === cell.day && selectedMatrixEvent.hour === cell.hour,
                            'z-50': hoveredMatrixCell && hoveredMatrixCell.day === cell.day && hoveredMatrixCell.hour === cell.hour
                          }"
                          :style="cell.status === 'partial' ? {
                            background: `linear-gradient(to top, #B91C1C 0%, #B91C1C ${cell.percent}%, #16A34A ${cell.percent}%, #16A34A 100%)`
                          } : {}"
                        >
                          <!-- Floating Tooltip on Hover: smart 2D alignment (never clips container edge & never covers hovered cell) -->
                          <div 
                            v-if="hoveredMatrixCell && hoveredMatrixCell.day === cell.day && hoveredMatrixCell.hour === cell.hour && cell.tooltipText && cell.status !== 'nodata'"
                            class="pointer-events-none absolute z-[100] whitespace-nowrap flex flex-col"
                            :class="[
                              row.day <= 2 ? 'top-full mt-3' : 'bottom-full mb-3',
                              cell.hour >= 17 ? 'right-0 items-end' : (cell.hour <= 6 ? 'left-0 items-start' : 'left-1/2 -translate-x-1/2 items-center')
                            ]"
                          >
                            <div 
                              v-if="row.day <= 2" 
                              class="w-2 h-2 bg-slate-900 rotate-45 -mb-1 border-l border-t border-slate-700/80 z-10"
                              :class="cell.hour >= 17 ? 'mr-3' : (cell.hour <= 6 ? 'ml-3' : '')"
                            ></div>
                            <div class="px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-semibold shadow-2xl border border-slate-700/80">
                              {{ cell.tooltipText }}
                            </div>
                            <div 
                              v-if="row.day > 2" 
                              class="w-2 h-2 bg-slate-900 rotate-45 -mt-1 border-r border-b border-slate-700/80 z-10"
                              :class="cell.hour >= 17 ? 'mr-3' : (cell.hour <= 6 ? 'ml-3' : '')"
                            ></div>
                          </div>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Selected Event Callout Banner (Mobile tap result) -->
              <div 
                v-if="selectedMatrixEvent" 
                class="mt-3 p-3 sm:p-3.5 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-between text-xs animate-in fade-in duration-200"
              >
                <div class="flex items-center gap-2.5">
                  <span 
                    class="w-3 h-3 rounded-full shrink-0"
                    :class="{
                      'bg-nordic-terracotta-700': selectedMatrixEvent.type === 'off',
                      'bg-[#16A34A]': selectedMatrixEvent.type === 'on',
                      'bg-[#D97706]': selectedMatrixEvent.type === 'partial',
                      'bg-slate-300': selectedMatrixEvent.type === 'nodata',
                    }"
                  ></span>
                  <div class="flex flex-col">
                    <div class="flex items-center gap-2">
                      <span class="font-extrabold text-slate-900 text-sm">
                        {{ selectedMatrixEvent.type === 'off' ? t('history.matrixContinuousOutage') : (selectedMatrixEvent.type === 'on' ? t('history.matrixContinuousPower') : t('history.exactOutageFill')) }}:
                        {{ selectedMatrixEvent.durationStr }}
                      </span>
                      <span 
                        v-if="selectedMatrixEvent.crossesMidnight" 
                        class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200"
                      >
                        ⚡ 24h+ Multi-day
                      </span>
                    </div>
                    <span class="text-[11px] text-slate-500 font-semibold mt-0.5">
                      {{ selectedMatrixEvent.startStr }} → {{ selectedMatrixEvent.endStr }}
                    </span>
                  </div>
                </div>

                <button 
                  @click="selectedMatrixEvent = null" 
                  class="text-slate-400 hover:text-slate-600 p-1 -mr-1"
                  aria-label="Close details"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>

              <!-- Matrix Legend -->
              <div class="flex flex-wrap items-center justify-between text-[11px] text-slate-500 mt-3 pt-3 border-t border-slate-200/80 gap-2">
                <div class="flex items-center gap-1.5">
                  <span class="w-2.5 h-2.5 rounded-[2px] bg-[#16A34A]"></span>
                  <span>{{ t('history.matrixLegendOn') }}</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="w-2.5 h-2.5 rounded-[2px] bg-[#D97706]"></span>
                  <span>{{ t('history.matrixLegendPartial') }}</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="w-2.5 h-2.5 rounded-[2px] bg-nordic-terracotta-700"></span>
                  <span>{{ t('history.matrixLegendOff') }}</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="w-2.5 h-2.5 rounded-[2px] bg-slate-200"></span>
                  <span>{{ t('history.matrixLegendNoData') }}</span>
                </div>
              </div>
            </div>

            <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <span class="text-xs font-bold text-slate-700 block mb-1">{{ t('history.blackoutMonthDesc') }}</span>
              <p class="text-[11px] text-slate-500 mb-4">{{ t('history.blackoutMonthSub') }}</p>
              <div class="h-[320px] w-full">
                <Bar :data="monthBlackoutChartData" :options="monthBlackoutOptions" />
              </div>
            </div>
          </div>
        </template>
      </div>
      </div>
    </div>
  </div>
</template>
