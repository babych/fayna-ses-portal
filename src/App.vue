<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, watchEffect, defineAsyncComponent, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { 
  Plus, 
  RefreshCw, 
  Search, 
  LayoutGrid, 
  Table as TableIcon, 
  Download, 
  LineChart, 
  ExternalLink, 
  ChevronDown, 
  Globe,
  Bell
} from 'lucide-vue-next';

import type { StationMetadata, StationTelemetry, ComplexAggregate } from '@/types/models';
import { 
  PRECONFIGURED_STATIONS, 
  DASHBOARD_BASE_URL, 
  createInitialStationTelemetries,
  TOTAL_PRECONFIGURED_BATTERY_KWH,
  HAS_PRECONFIGURED_SOLAR
} from '@/constants/stations';
import { 
  fetchTodayFeed, 
  fetchDayHistory, 
  buildStationTelemetry 
} from '@/services/api';
import { useStationI18n } from '@/composables/useStationI18n';

import HeroOverview from '@/components/HeroOverview.vue';
import StationCard from '@/components/StationCard.vue';

// Lazy load all modals so their markup, validation and icons don't block initial page render
const loadAddStationModal = () => import('@/components/AddStationModal.vue');
const AddStationModal = defineAsyncComponent(loadAddStationModal);
const preloadAddStationModal = () => { loadAddStationModal().catch(() => {}); };
const loadPwaInstallModal = () => import('@/components/PwaInstallModal.vue');
const PwaInstallModal = defineAsyncComponent(loadPwaInstallModal);
const preloadPwaInstallModal = () => { loadPwaInstallModal().catch(() => {}); };
const loadStationHistoryModal = () => import('@/components/StationHistoryModal.vue');
const StationHistoryModal = defineAsyncComponent(loadStationHistoryModal);
const preloadStationHistoryModal = () => {
  loadStationHistoryModal().catch(() => {});
};
const loadPushNotificationModal = () => import('@/components/PushNotificationModal.vue');
const PushNotificationModal = defineAsyncComponent(loadPushNotificationModal);
const preloadPushNotificationModal = () => { loadPushNotificationModal().catch(() => {}); };
const loadComplexOutagesModal = () => import('@/components/ComplexOutagesModal.vue');
const ComplexOutagesModal = defineAsyncComponent(loadComplexOutagesModal);
const preloadComplexOutagesModal = () => {
  loadComplexOutagesModal().catch(() => {});
};

const { t, locale } = useI18n();
const { getStationName, getStationDesc } = useStationI18n();

const toggleLanguage = () => {
  const next = locale.value === 'uk' ? 'en' : 'uk';
  locale.value = next;
  localStorage.setItem('fayna_ses_locale', next);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
  }
};

import { useTheme } from '@/composables/useTheme';
const { isGraphite: isGraphiteTheme, toggleGraphiteTheme } = useTheme();

const stationsMeta = ref<StationMetadata[]>([...PRECONFIGURED_STATIONS]);
// Pre-render static skeleton cards immediately on mount (Zero-CLS)
const telemetries = ref<StationTelemetry[]>(createInitialStationTelemetries());
const loading = ref(true);
const refreshing = ref(false);
const isManualRefreshing = ref(false);
const searchQuery = ref('');
const viewMode = ref<'grid' | 'table'>('grid');
const isAddModalOpen = ref(false);
const isPwaModalOpen = ref(false);
const isPushModalOpen = ref(false);
const isComplexOutagesModalOpen = ref(false);
const complexOutagesDate = ref<string>('');
const isStandalone = ref(
  typeof window !== 'undefined' && 
  (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true)
);

const isDashboardMenuOpen = ref(false);
const dashboardButtonRef = ref<HTMLElement | null>(null);

const toggleDashboardMenu = () => {
  isDashboardMenuOpen.value = !isDashboardMenuOpen.value;
};

const handleClickOutside = (event: MouseEvent) => {
  if (dashboardButtonRef.value && !dashboardButtonRef.value.contains(event.target as Node)) {
    isDashboardMenuOpen.value = false;
  }
};

const selectedStationForHistory = ref<StationTelemetry | null>(null);
const isHistoryModalOpen = ref(false);
const historyModalTab = ref<'telemetry' | 'day' | 'blackouts' | 'month'>('telemetry');
const historyModalSubtab = ref<'day' | 'month'>('day');
const historyModalDate = ref<string>('');
const historyModalMonth = ref<string>('');

const updateUrlState = (replace = false) => {
  const url = new URL(window.location.href);
  
  if (isHistoryModalOpen.value && selectedStationForHistory.value) {
    url.searchParams.set('station', selectedStationForHistory.value.id);
    url.searchParams.set('tab', historyModalTab.value);
    if (historyModalTab.value === 'blackouts' && historyModalSubtab.value) {
      url.searchParams.set('subtab', historyModalSubtab.value);
    } else {
      url.searchParams.delete('subtab');
    }
    if (historyModalDate.value && (historyModalTab.value === 'telemetry' || historyModalTab.value === 'day' || (historyModalTab.value === 'blackouts' && historyModalSubtab.value === 'day'))) {
      url.searchParams.set('date', historyModalDate.value);
    } else {
      url.searchParams.delete('date');
    }
    if (historyModalMonth.value && (historyModalTab.value === 'month' || (historyModalTab.value === 'blackouts' && historyModalSubtab.value === 'month'))) {
      url.searchParams.set('month', historyModalMonth.value);
    } else {
      url.searchParams.delete('month');
    }
    url.searchParams.delete('modal');
  } else if (isAddModalOpen.value) {
    url.searchParams.delete('station');
    url.searchParams.delete('tab');
    url.searchParams.delete('subtab');
    url.searchParams.delete('date');
    url.searchParams.delete('month');
    url.searchParams.set('modal', 'add');
  } else if (isPwaModalOpen.value) {
    url.searchParams.delete('station');
    url.searchParams.delete('tab');
    url.searchParams.delete('subtab');
    url.searchParams.delete('date');
    url.searchParams.delete('month');
    url.searchParams.set('modal', 'install');
  } else if (isComplexOutagesModalOpen.value) {
    url.searchParams.delete('station');
    url.searchParams.delete('tab');
    url.searchParams.delete('subtab');
    url.searchParams.delete('month');
    url.searchParams.set('modal', 'outages');
    if (complexOutagesDate.value) {
      url.searchParams.set('date', complexOutagesDate.value);
    } else {
      url.searchParams.delete('date');
    }
  } else {
    url.searchParams.delete('station');
    url.searchParams.delete('s');
    url.searchParams.delete('tab');
    url.searchParams.delete('subtab');
    url.searchParams.delete('date');
    url.searchParams.delete('month');
    url.searchParams.delete('modal');
    url.searchParams.delete('history');
  }

  const newUrl = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') + url.hash;
  if (replace) {
    window.history.replaceState({ modal: isHistoryModalOpen.value ? 'history' : null }, '', newUrl);
  } else {
    window.history.pushState({ modal: isHistoryModalOpen.value ? 'history' : null }, '', newUrl);
  }
};

const cameFromComplexOutages = ref(false);

const openHistoryFromOutages = (station: StationTelemetry) => {
  cameFromComplexOutages.value = true;
  isComplexOutagesModalOpen.value = false;
  openHistory(station, 'blackouts');
};

const backToComplexOutages = () => {
  cameFromComplexOutages.value = false;
  isHistoryModalOpen.value = false;
  selectedStationForHistory.value = null;
  isComplexOutagesModalOpen.value = true;
  updateUrlState();
};

const openHistory = (station: StationTelemetry, tab: 'telemetry' | 'day' | 'blackouts' | 'month' = 'telemetry') => {
  preloadStationHistoryModal(); preloadComplexOutagesModal();
  requestAnimationFrame(() => {
    selectedStationForHistory.value = station;
    historyModalTab.value = tab;
    isHistoryModalOpen.value = true;
    updateUrlState();
  });
};

const closeHistory = () => {
  isHistoryModalOpen.value = false;
  selectedStationForHistory.value = null;
  historyModalDate.value = '';
  historyModalMonth.value = '';
  updateUrlState();
};

const onModalTabChange = (tab: string) => {
  historyModalTab.value = (tab === 'day' ? 'telemetry' : tab) as any;
  updateUrlState(true);
};

const onModalSubtabChange = (subtab: string) => {
  historyModalSubtab.value = subtab as any;
  updateUrlState(true);
};

const onModalDateChange = (date: string) => {
  historyModalDate.value = date;
  updateUrlState(true);
};

const onModalMonthChange = (month: string) => {
  historyModalMonth.value = month;
  updateUrlState(true);
};

const openAddModal = () => {
  preloadAddStationModal();
  requestAnimationFrame(() => {
    isAddModalOpen.value = true;
    updateUrlState();
  });
};

const closeAddModal = () => {
  isAddModalOpen.value = false;
  updateUrlState();
};

const openComplexOutages = () => {
  preloadComplexOutagesModal();
  requestAnimationFrame(() => {
    isComplexOutagesModalOpen.value = true;
    updateUrlState();
  });
};

const closeComplexOutages = () => {
  isComplexOutagesModalOpen.value = false;
  complexOutagesDate.value = '';
  updateUrlState();
};

const onComplexOutagesDateChange = (date: string) => {
  complexOutagesDate.value = date;
  updateUrlState(true);
};

const openPwaModal = () => {
  preloadPwaInstallModal();
  requestAnimationFrame(() => {
    isPwaModalOpen.value = true;
    updateUrlState();
  });
};

const closePwaModal = () => {
  isPwaModalOpen.value = false;
  updateUrlState();
};

const resetToHome = () => {
  searchQuery.value = '';
  isHistoryModalOpen.value = false;
  isAddModalOpen.value = false;
  isPwaModalOpen.value = false;
  selectedStationForHistory.value = null;
  window.history.pushState({}, '', window.location.pathname);
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

const STORAGE_KEY = 'fayna_ses_custom_stations';

const loadSavedStations = () => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed: StationMetadata[] = JSON.parse(saved);
      const merged = [...PRECONFIGURED_STATIONS];
      for (const item of parsed) {
        if (!merged.some(s => s.id === item.id)) {
          merged.push(item);
          // If custom stations exist in storage, pre-render their slots too
          if (!telemetries.value.some(t => t.id === item.id)) {
            telemetries.value.push(...createInitialStationTelemetries([item]));
          }
        }
      }
      stationsMeta.value = merged;
      return;
    } catch (e) {
      console.error('Failed to parse saved stations', e);
    }
  }
  stationsMeta.value = [...PRECONFIGURED_STATIONS];
};

const saveCustomStation = (meta: StationMetadata) => {
  if (!stationsMeta.value.some(s => s.id === meta.id)) {
    stationsMeta.value.push(meta);
  }
  const customOnly = stationsMeta.value.filter(s => s.isCustom);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(customOnly));
  fetchSingleTelemetry(meta);
};

const removeCustomStation = (id: string) => {
  stationsMeta.value = stationsMeta.value.filter(s => s.id !== id);
  telemetries.value = telemetries.value.filter(t => t.id !== id);
  const customOnly = stationsMeta.value.filter(s => s.isCustom);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(customOnly));
};

const fetchSingleTelemetry = async (meta: StationMetadata) => {
  try {
    const feed = await fetchTodayFeed(meta.id);
    const telemetry = buildStationTelemetry(meta, feed);
    const idx = telemetries.value.findIndex(t => t.id === meta.id);
    if (idx >= 0) {
      telemetries.value[idx] = telemetry;
    } else {
      telemetries.value.push(telemetry);
    }
  } catch (err) {
    console.warn(`Could not fetch data for station ${meta.id}:`, err);
  }
};

const fetchAllTelemetries = async () => {
  refreshing.value = true;
  // Fetch all station telemetries in parallel first
  const results = await Promise.allSettled(
    stationsMeta.value.map(async (meta) => {
      const feed = await fetchTodayFeed(meta.id);
      return buildStationTelemetry(meta, feed);
    })
  );

  // In-place property mutation for existing stations:
  // Preserves existing Vue component instances, preventing full DOM tearing or re-mounting
  results.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      const telemetry = res.value;
      const target = telemetries.value.find(t => t.id === telemetry.id);
      if (target) {
        Object.assign(target, telemetry);
      } else {
        telemetries.value.push(telemetry);
      }
    } else {
      console.warn(`Could not fetch data for station ${stationsMeta.value[i].id}:`, res.reason);
    }
  });
  // Calculate blackout duration first so all complex metrics update in a single atomic tick
  await updateComplexBlackoutDuration().catch(() => {});
  loading.value = false;
  refreshing.value = false;
};

const handleManualRefresh = async () => {
  if (isManualRefreshing.value) return;
  isManualRefreshing.value = true;
  const startTime = Date.now();
  try {
    await fetchAllTelemetries();
  } finally {
    // 500ms 45-degree rotation animation with spring-back
    const elapsed = Date.now() - startTime;
    const remainingDelay = Math.max(0, 500 - elapsed);
    setTimeout(() => {
      isManualRefreshing.value = false;
    }, remainingDelay);
  }
};

let refreshInterval: any = null;

let hasScrolledToInitialStation = false;

const scrollToStationCard = (stationId: string, immediate = false) => {
  nextTick(() => {
    const el = document.getElementById(`station-${stationId}`);
    if (el) {
      // Precise offset factoring sticky header (h-16 = 64px) + breathing room (16px)
      const headerEl = document.querySelector('header');
      const headerHeight = headerEl ? headerEl.getBoundingClientRect().height : 64;
      const headerOffset = headerHeight + 16;
      
      const elementPosition = el.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

      window.scrollTo({
        top: Math.max(0, offsetPosition),
        behavior: immediate ? 'auto' : 'smooth',
      });

      el.classList.add('ring-2', 'ring-emerald-500', 'ring-offset-4');
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-emerald-500', 'ring-offset-4');
      }, 2500);
    }
  });
};

const syncStateFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const targetId = params.get('station') || params.get('s');
  const tabParam = params.get('tab');
  const subtabParam = params.get('subtab');
  const dateParam = params.get('date');
  const monthParam = params.get('month');
  const modalParam = params.get('modal');

  if (targetId) {
    const found = telemetries.value.find(t => t.id === targetId || t.id.startsWith(targetId));
    if (found) {
      // If URL explicitly requests a modal tab (tab=telemetry|blackouts|month) or modal=history
      if (tabParam || modalParam === 'history') {
        selectedStationForHistory.value = found;
        if (tabParam === 'blackouts' || tabParam === 'month' || tabParam === 'day' || tabParam === 'telemetry') {
          historyModalTab.value = (tabParam === 'day' ? 'telemetry' : tabParam) as any;
        }
        if (subtabParam === 'day' || subtabParam === 'month') {
          historyModalSubtab.value = subtabParam;
        }
        if (dateParam) historyModalDate.value = dateParam;
        if (monthParam) historyModalMonth.value = monthParam;
        isHistoryModalOpen.value = true;
        isAddModalOpen.value = false;
        isPwaModalOpen.value = false;
      } else {
        // Plain link to station (e.g. from Share button /?station=...): scroll to card exactly once!
        isHistoryModalOpen.value = false;
        selectedStationForHistory.value = null;
        if (!hasScrolledToInitialStation) {
          hasScrolledToInitialStation = true;
          scrollToStationCard(found.id, true);
        }
        return;
      }
      return;
    }
  } else {
    isHistoryModalOpen.value = false;
    selectedStationForHistory.value = null;
  }

  if (modalParam === 'add') {
    isAddModalOpen.value = true;
    isPwaModalOpen.value = false;
    isHistoryModalOpen.value = false;
    isComplexOutagesModalOpen.value = false;
  } else if (modalParam === 'install' || modalParam === 'pwa') {
    isPwaModalOpen.value = true;
    isAddModalOpen.value = false;
    isHistoryModalOpen.value = false;
    isComplexOutagesModalOpen.value = false;
  } else if (modalParam === 'outages' || modalParam === 'timeline') {
    isComplexOutagesModalOpen.value = true;
    if (dateParam) complexOutagesDate.value = dateParam;
    isAddModalOpen.value = false;
    isPwaModalOpen.value = false;
    isHistoryModalOpen.value = false;
  } else if (!targetId) {
    isAddModalOpen.value = false;
    isPwaModalOpen.value = false;
    isComplexOutagesModalOpen.value = false;
  }
};

const onPopState = () => {
  syncStateFromUrl();
};

const SCROLL_POS_KEY = 'fayna_ses_last_scroll_y';

const isAnyModalOpen = computed(() => {
  return (
    isHistoryModalOpen.value ||
    isComplexOutagesModalOpen.value ||
    isAddModalOpen.value ||
    isPwaModalOpen.value ||
    isPushModalOpen.value
  );
});

watch(isAnyModalOpen, (isOpen) => {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = isOpen ? 'hidden' : '';
  }
});

const handleGlobalKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    if (isHistoryModalOpen.value) {
      closeHistory();
    } else if (isComplexOutagesModalOpen.value) {
      closeComplexOutages();
    } else if (isAddModalOpen.value) {
      closeAddModal();
    } else if (isPwaModalOpen.value) {
      closePwaModal();
    } else if (isPushModalOpen.value) {
      isPushModalOpen.value = false;
    }
  }
};

let scrollSaveTimer: any = null;
const handleScroll = () => {
  if (scrollSaveTimer) cancelAnimationFrame(scrollSaveTimer);
  scrollSaveTimer = requestAnimationFrame(() => {
    sessionStorage.setItem(SCROLL_POS_KEY, window.scrollY.toString());
  });
};

const handleBeforeInstallPrompt = (e: Event) => {
  e.preventDefault();
  deferredPrompt.value = e;
  canDirectInstall.value = true;
};

onMounted(async () => {
  // Clear any pending App Badge & active notifications upon user visiting the portal or returning from background
  const clearBadgeSafely = async () => {
    if (typeof navigator !== 'undefined') {
      try {
        if ('setAppBadge' in navigator) {
          await (navigator as any).setAppBadge(0).catch(() => {});
        }
        if ('clearAppBadge' in navigator) {
          await (navigator as any).clearAppBadge().catch(() => {});
        }
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg && 'getNotifications' in reg) {
            const notifs = await reg.getNotifications();
            notifs.forEach(n => n.close());
          }
        }
      } catch (_) {}
    }
  };
  clearBadgeSafely();

  // Automatic PWA Service Worker updates: check on resume / visible
  const checkForUpdatesSafely = async () => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update();
        }
      } catch (_) {}
    }
  };

  // Seamless auto-reload when an updated Service Worker takes control
  // Only reload if the page was ALREADY controlled by an older worker
  // (Prevents double reload on initial page load when first SW claims clients)
  let refreshingPage = false;
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const hadInitialController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadInitialController && !refreshingPage) {
        refreshingPage = true;
        window.location.reload();
      }
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      clearBadgeSafely();
      checkForUpdatesSafely();
    }
  });
  window.addEventListener("focus", () => {
    clearBadgeSafely();
    checkForUpdatesSafely();
  });

  if (typeof window !== 'undefined') {
    isStandalone.value = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('keydown', handleGlobalKeydown);
  }

  loadSavedStations();
  // Sync URL immediately on mount so deep link scrolling doesn't wait for network fetch
  syncStateFromUrl();

  // Restore scroll position on plain refresh (if not targeting a specific station via URL)
  const params = new URLSearchParams(window.location.search);
  if (!params.get('station') && !params.get('s')) {
    const savedY = sessionStorage.getItem(SCROLL_POS_KEY);
    if (savedY) {
      const y = parseInt(savedY, 10);
      if (!isNaN(y) && y > 0) {
        window.scrollTo({ top: y, behavior: 'instant' });
      }
    }
  }

  // Continuously persist current scroll position (throttled)
  window.addEventListener('scroll', handleScroll, { passive: true });

  await fetchAllTelemetries();
  syncStateFromUrl();
  refreshInterval = setInterval(fetchAllTelemetries, 60000);
  document.addEventListener('click', handleClickOutside);
  window.addEventListener('popstate', onPopState);

  // Background idle preloading of StationHistoryModal chunk without competing with initial render
  if (typeof window !== 'undefined') {
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => { preloadStationHistoryModal(); preloadComplexOutagesModal(); }, { timeout: 3000 });
    } else {
      setTimeout(() => { preloadStationHistoryModal(); preloadComplexOutagesModal(); }, 1500);
    }
  }
});

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval);
  document.removeEventListener('click', handleClickOutside);
  window.removeEventListener('popstate', onPopState);
  window.removeEventListener('scroll', handleScroll);
  window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  window.removeEventListener('keydown', handleGlobalKeydown);
  if (typeof document !== 'undefined') {
    document.body.style.overflow = '';
  }
});


const yesterdayFeedsCache = new Map<string, any>();
const complexBlackoutDurationMinutes = ref<number>(0);

const getPreviousDateStr = (dateStr: string) => {
  const parts = dateStr.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const updateComplexBlackoutDuration = async () => {
  const list = telemetries.value;
  if (!list.length) return;
  const blackoutStations = list.filter(s => !s.isStale && Math.abs(s.gridPower) <= 20 && (s.batteryPower > 50 || s.buildingPower > 50));
  if (!blackoutStations.length) {
    complexBlackoutDurationMinutes.value = 0;
    return;
  }

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const yesterdayStr = getPreviousDateStr(todayStr);

  const durationPromises = blackoutStations.map(async (st) => {
    const feed = st.history;
    if (!feed || !feed.timestamps || !feed.timestamps.length) return 0;
    const t = feed.timestamps;
    const g = feed.grid;
    const l = feed.load;
    const b = feed.batt;
    let idx = t.length - 1;
    let startTs = t[idx];
    const lastTs = t[idx];

    while (idx >= 0) {
      const gv = g[idx] ?? 0;
      const lv = l[idx] ?? 0;
      const bv = b[idx] ?? 0;
      if (Math.abs(gv) <= 20 && (lv > 20 || bv > 50)) {
        startTs = t[idx];
        idx--;
      } else {
        // Check if this light period is a brief restoration (<= 15 min)
        const lightEnd = t[idx];
        let lightStart = t[idx];
        let tempIdx = idx;
        while (tempIdx >= 0) {
          const tgv = g[tempIdx] ?? 0;
          const tlv = l[tempIdx] ?? 0;
          const tbv = b[tempIdx] ?? 0;
          if (!(Math.abs(tgv) <= 20 && (tlv > 20 || tbv > 50))) {
            lightStart = t[tempIdx];
            tempIdx--;
          } else {
            break;
          }
        }
        const lightDurMin = Math.floor((lightEnd - lightStart) / 60);
        if (lightDurMin <= 30) {
          idx = tempIdx;
        } else {
          break;
        }
      }
    }

    // If outage reached the beginning of today, check yesterday feed
    if (idx < 0) {
      const cacheKey = `${st.id}:${yesterdayStr}`;
      let yFeed = yesterdayFeedsCache.get(cacheKey);
      if (!yFeed) {
        yFeed = await fetchDayHistory(st.id, yesterdayStr).catch(() => null);
        if (yFeed) yesterdayFeedsCache.set(cacheKey, yFeed);
      }
      if (yFeed && yFeed.t && yFeed.t.length) {
        const ty = yFeed.t;
        const gy = yFeed.grid;
        const ly = yFeed.load;
        const by = yFeed.batt || [];
        let yIdx = ty.length - 1;
        while (yIdx >= 0) {
          const gyv = gy[yIdx] ?? 0;
          const lyv = ly[yIdx] ?? 0;
          const byv = by[yIdx] ?? 0;
          if (Math.abs(gyv) <= 20 && (lyv > 20 || byv > 50)) {
            startTs = ty[yIdx];
            yIdx--;
          } else {
            const yLightEnd = ty[yIdx];
            let yLightStart = ty[yIdx];
            let tempYIdx = yIdx;
            while (tempYIdx >= 0) {
              const tygv = gy[tempYIdx] ?? 0;
              const tylv = ly[tempYIdx] ?? 0;
              const tybv = by[tempYIdx] ?? 0;
              if (!(Math.abs(tygv) <= 20 && (tylv > 20 || tybv > 50))) {
                yLightStart = ty[tempYIdx];
                tempYIdx--;
              } else {
                break;
              }
            }
            const yLightDurMin = Math.floor((yLightEnd - yLightStart) / 60);
            if (yLightDurMin <= 30) {
              yIdx = tempYIdx;
            } else {
              break;
            }
          }
        }
      }
    }

    return Math.max(0, Math.floor((lastTs - startTs) / 60));
  });

  const durations = await Promise.all(durationPromises);
  complexBlackoutDurationMinutes.value = durations.length ? Math.max(...durations) : 0;
};

const complexStats = ref<ComplexAggregate>({
  totalStations: PRECONFIGURED_STATIONS.length,
  onlineStations: PRECONFIGURED_STATIONS.length,
  totalBatteryCapacityKwh: TOTAL_PRECONFIGURED_BATTERY_KWH,
  currentStoredEnergyKwh: 0,
  averageBatteryLevel: 0,
  totalSolarPowerW: 0,
  totalGridPowerW: 0,
  totalBatteryPowerW: 0,
  totalBuildingPowerW: 0,
  isBlackout: false,
  blackoutStatus: 'normal',
  blackoutCount: 0,
  estimatedComplexAutonomyHours: null,
});

watchEffect(() => {
  const list = telemetries.value;
  if (!list.length) return;
  if (loading.value && list.every((t) => t.updatedAt === null)) return;

  let totalCapacity = 0;
  let currentStored = 0;
  let totalSolar = 0;
  let totalGrid = 0;
  let totalBatt = 0;
  let totalBuilding = 0;
  let onlineCount = 0;

  for (const st of list) {
    if (!st.isStale && !st.isDrained) onlineCount++;
    totalCapacity += st.batteryKwh;
    if (!st.isDrained) {
      currentStored += st.remainingEnergyKwh;
      totalSolar += st.solarPower;
      totalGrid += st.gridPower;
      totalBatt += st.batteryPower;
      totalBuilding += st.buildingPower;
    }
  }

  const avgLevel = totalCapacity > 0 ? (currentStored / totalCapacity) * 100 : 0;
  
  // Calculate blackout stations count:
  // Grid must be dead (|grid| <= 20W, ruling out negative elevator regenerative braking)
  // AND either battery is actively supplying load (> 50W) or building load exists without grid
  const blackoutStations = list.filter(s => !s.isStale && Math.abs(s.gridPower) <= 20 && (s.batteryPower > 50 || s.buildingPower > 50));
  const blackoutCount = blackoutStations.length;
  const isFullBlackout = onlineCount > 0 && blackoutCount === onlineCount;
  const isPartialBlackout = blackoutCount > 0 && blackoutCount < onlineCount;
  const blackoutStatus: 'normal' | 'partial' | 'full' = isFullBlackout ? 'full' : (isPartialBlackout ? 'partial' : 'normal');
  const isBlackout = blackoutCount > 0;

  let estimatedHours: number | null = null;
  if (currentStored > 0) {
    let totalAvgLoadW = 0;
    let activeBlackoutDischargeW = 0;

    for (const st of list) {
      if (!st.isDrained) {
        totalAvgLoadW += (st.avgLoadW || 0);
        // Only count battery discharge if the station is in an actual blackout
        const isStationInBlackout = Math.abs(st.gridPower) <= 20 && st.batteryPower > 50;
        if (isStationInBlackout) {
          activeBlackoutDischargeW += st.batteryPower;
        }
      }
    }

    // Baseline floor per active station (~500W each)
    const baselineW = Math.max(1500, onlineCount * 500);

    if (isBlackout && activeBlackoutDischargeW > 300) {
      // Active blackout: forecast based on current real-time battery discharge
      const dischargeKw = activeBlackoutDischargeW / 1000;
      estimatedHours = Math.round((currentStored / dischargeKw) * 10) / 10;
    } else {
      // Standby / Grid connected: calculate expected autonomy when grid goes down
      // using average daily consumption or active building load
      const referenceLoadW = totalAvgLoadW > 0 
        ? totalAvgLoadW 
        : (totalBuilding > 0 ? totalBuilding : baselineW);
      const effectiveKw = Math.max(baselineW, referenceLoadW) / 1000;
      estimatedHours = Math.round((currentStored / effectiveKw) * 10) / 10;
    }
  }

  // PWA App Badge: Always clear badge on user visiting the active web app
  if (typeof navigator !== 'undefined') {
    if ('setAppBadge' in navigator) (navigator as any).setAppBadge(0).catch(() => {});
    if ('clearAppBadge' in navigator) (navigator as any).clearAppBadge().catch(() => {});
  }

  complexStats.value = {
    totalStations: list.length,
    onlineStations: onlineCount,
    totalBatteryCapacityKwh: Math.round(totalCapacity),
    currentStoredEnergyKwh: Math.round(currentStored * 10) / 10,
    averageBatteryLevel: Math.round(avgLevel),
    totalSolarPowerW: totalSolar,
    totalGridPowerW: totalGrid,
    totalBatteryPowerW: totalBatt,
    totalBuildingPowerW: totalBuilding,
    isBlackout,
    blackoutStatus,
    blackoutCount,
    blackoutDurationMinutes: complexBlackoutDurationMinutes.value,
    estimatedComplexAutonomyHours: estimatedHours,
  };
});

function parseBuildingAndHoa(name: string) {
  const bMatch = /Building\s+(\d+)|Будинок\s+(\d+)/i.exec(name);
  const hMatch = /HOA\s+#?(\d+)|ОСББ\s+#?(\d+)/i.exec(name);
  const buildingNum = bMatch ? parseInt(bMatch[1] || bMatch[2], 10) : 9999;
  const hoaNum = hMatch ? parseInt(hMatch[1] || hMatch[2], 10) : 9999;
  return { buildingNum, hoaNum };
}

const filteredTelemetries = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  let list = telemetries.value;
  if (q) {
    list = list.filter(st => {
      const name = getStationName(st).toLowerCase();
      const desc = getStationDesc(st).toLowerCase();
      return name.includes(q) || desc.includes(q);
    });
  }

  // Always keep cards sorted primarily by Building number, then HOA number
  return [...list].sort((a, b) => {
    const infoA = parseBuildingAndHoa(a.name);
    const infoB = parseBuildingAndHoa(b.name);
    if (infoA.buildingNum !== infoB.buildingNum) {
      return infoA.buildingNum - infoB.buildingNum;
    }
    if (infoA.hoaNum !== infoB.hoaNum) {
      return infoA.hoaNum - infoB.hoaNum;
    }
    return a.name.localeCompare(b.name);
  });
});

const deferredPrompt = ref<any>(null);
const canDirectInstall = ref(false);

const handleInstallClick = () => {
  if (canDirectInstall.value && deferredPrompt.value) {
    deferredPrompt.value.prompt();
    deferredPrompt.value.userChoice.then((choice: any) => {
      if (choice.outcome === 'accepted') {
        canDirectInstall.value = false;
      }
      deferredPrompt.value = null;
    });
  } else {
    openPwaModal();
  }
};

const handleModalDirectInstall = async () => {
  if (deferredPrompt.value) {
    deferredPrompt.value.prompt();
    const { outcome } = await deferredPrompt.value.userChoice;
    if (outcome === 'accepted') {
      canDirectInstall.value = false;
      closePwaModal();
    }
    deferredPrompt.value = null;
  }
};
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-800 flex flex-col justify-between selection:bg-emerald-500 selection:text-white">
    <!-- Header -->
    <header class="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-4">
        <a 
          href="/" 
          @click.prevent="resetToHome"
          class="flex items-center gap-2.5 sm:gap-3 cursor-pointer group shrink-0"
          title="Fayna SES Home"
        >
          <!-- App Identity Icon matching PWA App Icon -->
          <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-br from-[#323842] to-[#242830] p-1 shadow-md shadow-slate-900/15 border border-slate-600/40 group-hover:scale-105 group-hover:border-emerald-500/60 transition-all flex items-center justify-center shrink-0">
            <svg class="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="headerEnergyGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#10b981" />
                  <stop offset="100%" stop-color="#34d399" />
                </linearGradient>
              </defs>
              <!-- 1. Vertical Spine (Platinum White) -->
              <rect x="148" y="128" width="52" height="256" rx="14" fill="#f8fafc" />
              <!-- 2. Top Horizontal Bar (Platinum White) -->
              <rect x="148" y="128" width="216" height="52" rx="14" fill="#f8fafc" />
              <!-- 3. Mid Horizontal Bar (Vibrant Solar Emerald Accent) -->
              <rect x="148" y="234" width="168" height="48" rx="14" fill="url(#headerEnergyGrad)" />
              <!-- Energy Node Accent -->
              <circle cx="340" cy="258" r="8" fill="#10b981" />
            </svg>
          </div>
          <div class="leading-tight">
            <span class="text-sm sm:text-base font-extrabold tracking-tight text-slate-900 flex items-center gap-1 group-hover:text-emerald-600 transition-colors whitespace-nowrap">
              {{ t('brand') }} <span class="text-emerald-500">⚡</span>
            </span>
            <span class="text-[10px] sm:text-[11px] text-slate-500 block font-semibold whitespace-nowrap">{{ t('subBrand') }}</span>
          </div>
        </a>

        <div class="flex items-center gap-1 sm:gap-2 shrink-0">
          <!-- Push Notifications Button -->
          <button
            @click="isPushModalOpen = true"
            @pointerenter="preloadPushNotificationModal"
            @focus="preloadPushNotificationModal"
            class="p-1.5 sm:p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-emerald-700 transition-all border border-slate-200 shrink-0"
            :title="t('notifications')"
          >
            <Bell class="w-4 h-4" />
          </button>

          <!-- Language Switcher UA / EN (Shows target language to switch to) -->
          <button
            @click="toggleLanguage"
            class="flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all border border-slate-200"
            :title="locale === 'uk' ? 'Switch to English' : 'Перемкнути на українську'"
          >
            <Globe class="w-3.5 h-3.5 text-emerald-600" />
            <span>{{ locale === 'uk' ? 'EN' : 'UA' }}</span>
          </button>

          <!-- Install PWA Button (Hidden when running inside standalone PWA mode) -->
          <button 
            v-if="!isStandalone"
            @click="handleInstallClick"
            @pointerenter="preloadPwaInstallModal"
            @focus="preloadPwaInstallModal"
            class="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition-all shadow-md shadow-emerald-600/20"
            :title="t('installApp')"
          >
            <Download class="w-3.5 h-3.5" />
            <span class="hidden xs:inline">{{ t('installApp') }}</span>
          </button>

          <!-- Refresh -->
          <button 
            type="button"
            @click.prevent.stop="handleManualRefresh"
            class="p-1.5 sm:p-2 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-200 shrink-0 select-none outline-none focus:outline-none"
            :class="{ 'pointer-events-none opacity-60': isManualRefreshing }"
            :title="t('refresh')"
          >
            <RefreshCw class="w-4 h-4 pointer-events-none" :class="{ 'animate-refresh-wiggle text-emerald-600': isManualRefreshing }" />
          </button>

          <!-- Add Station -->
          <button 
            @click="openAddModal"
            @pointerenter="preloadAddStationModal"
            @focus="preloadAddStationModal"
            class="hidden sm:flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-xs font-bold transition-all shadow-sm"
          >
            <Plus class="w-4 h-4 text-emerald-400" />
            <span>{{ t('addStation') }}</span>
          </button>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main 
      class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full space-y-6 flex-1 transition-opacity duration-300"
      :class="{ 'is-refreshing-data': isManualRefreshing }"
    >
      <HeroOverview 
        :stats="complexStats" 
        :loading="loading" 
        :has-solar="HAS_PRECONFIGURED_SOLAR || complexStats.totalSolarPowerW > 50"
        @open-complex-outages="openComplexOutages"
      />

      <!-- Filter and Search Bar -->
      <div class="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
        <div class="relative w-full sm:w-80">
          <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input 
            v-model="searchQuery"
            type="text"
            :placeholder="t('searchPlaceholder')"
            class="w-full pl-10 pr-4 py-2 rounded-lg bg-white border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 shadow-xs transition-all"
          />
        </div>

        <div class="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <span 
            class="text-xs text-slate-500 font-semibold whitespace-nowrap min-w-[90px] text-right"
          >
            {{ t('found', { count: filteredTelemetries.length || PRECONFIGURED_STATIONS.length }) }}
          </span>

          <div class="flex items-center p-1 rounded-lg bg-white border border-slate-200 shadow-xs">
            <button
              @click="viewMode = 'grid'"
              class="p-1.5 rounded-lg text-xs transition-colors"
              :class="viewMode === 'grid' ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-700'"
              :title="t('viewCards')"
            >
              <LayoutGrid class="w-4 h-4" />
            </button>
            <button
              @click="viewMode = 'table'"
              class="p-1.5 rounded-lg text-xs transition-colors"
              :class="viewMode === 'table' ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-700'"
              :title="t('viewTable')"
            >
              <TableIcon class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <!-- Cards Grid -->
      <div v-if="viewMode === 'grid'">
        <div v-if="filteredTelemetries.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <StationCard
            v-for="st in filteredTelemetries"
            :id="`station-${st.id}`"
            :key="st.id"
            :station="st"
            :is-initial-loading="loading && st.updatedAt === null"
            @show-history="openHistory"
            @remove="removeCustomStation"
          />
        </div>

        <div v-else class="text-center py-16 rounded-lg bg-white border border-slate-200">
          <p class="text-slate-500 text-sm font-medium">{{ t('emptySearch') }}</p>
        </div>
      </div>

      <!-- Table View -->
      <div v-else class="rounded-lg bg-white border border-slate-200 overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 uppercase tracking-wider text-[11px] border-b border-slate-200">
              <tr>
                <th class="py-3.5 px-4 font-bold">{{ t('thStation') }}</th>
                <th class="py-3.5 px-4 font-bold">{{ t('battery') }} (%)</th>
                <th class="py-3.5 px-4 font-bold">{{ t('battery') }} ({{ t('wUnit') }})</th>
                <th class="py-3.5 px-4 font-bold">{{ t('grid') }}</th>
                <th v-if="complexStats.totalSolarPowerW > 50" class="py-3.5 px-4 font-bold">{{ t('solar') }}</th>
                <th class="py-3.5 px-4 font-bold">{{ t('load') }}</th>
                <th class="py-3.5 px-4 font-bold">{{ t('history.inverter') }}</th>
                <th class="py-3.5 px-4 font-bold">{{ t('capacity') }}</th>
                <th class="py-3.5 px-4 font-bold">{{ t('status') }}</th>
                <th class="py-3.5 px-4 font-bold text-right">{{ t('analytics') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-for="st in filteredTelemetries" :key="st.id" :id="`station-${st.id}`" class="hover:bg-slate-50 transition-colors">
                <td class="py-3 px-4 font-bold text-slate-900">
                  <div>{{ getStationName(st) }}</div>
                  <div class="text-[11px] text-slate-400 font-normal">{{ getStationDesc(st) }}</div>
                </td>
                <td class="py-3 px-4 font-black" :class="st.batteryLevel > 50 ? 'text-emerald-600' : 'text-amber-600'">
                  {{ Math.round(st.batteryLevel) }}%
                </td>
                <td class="py-3 px-4 font-mono font-bold">
                  <span :class="st.batteryPower > 20 ? 'text-amber-600' : st.batteryPower < -20 ? 'text-emerald-600' : 'text-slate-500'">
                    {{ st.batteryPower > 0 ? `-${st.batteryPower}` : Math.abs(st.batteryPower) }} {{ t('wUnit') }}
                  </span>
                </td>
                <td class="py-3 px-4 font-mono font-bold" :class="st.gridPower <= 20 ? 'text-nordic-terracotta-700' : 'text-slate-700'">
                  {{ st.gridPower > 0 ? `${st.gridPower} ${t('wUnit')}` : `0 ${t('wUnit')}` }}
                </td>
                <td v-if="complexStats.totalSolarPowerW > 50" class="py-3 px-4 font-mono text-amber-600 font-bold">
                  {{ st.solarPower }} {{ t('wUnit') }}
                </td>
                <td class="py-3 px-4 font-mono text-purple-700 font-bold">
                  {{ st.buildingPower }} {{ t('wUnit') }}
                </td>
                <td class="py-3 px-4 text-slate-700 font-medium">
                  <span v-if="st.inverterKw > 0" class="inline-flex items-center gap-1">
                    {{ st.inverterKw }} {{ t('kwUnit') }}
                    <span class="text-[10px] text-slate-400">({{ st.inverterLoadPercent }}%)</span>
                  </span>
                  <span v-else class="text-slate-400">—</span>
                </td>
                <td class="py-3 px-4 text-slate-600 font-medium">
                  {{ st.batteryKwh }} {{ t('kwhUnit') }}
                </td>
                <td class="py-3 px-4">
                  <span 
                    class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                    :class="st.isDrained ? 'bg-rose-100 text-rose-800' : st.isStale ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'"
                  >
                    {{ st.isDrained ? t('drainedTag') : st.isStale ? t('stale') : t('online') }}
                  </span>
                </td>
                <td class="py-3 px-4 text-right">
                  <button
                    @click="openHistory(st)"
                    @pointerenter="preloadStationHistoryModal"
                    @focus="preloadStationHistoryModal"
                    class="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                    :title="t('analytics')"
                  >
                    <LineChart class="w-4 h-4" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>

    <!-- Site Footer -->
    <footer class="mt-12 border-t border-slate-200 bg-white text-xs text-slate-500 py-6 relative">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <span>{{ t('footerText') }}</span>
        </div>
        <div class="flex items-center gap-4 relative">
          <a href="https://github.com/babych/fayna-ses-portal" target="_blank" class="hover:text-slate-900 transition-colors font-semibold">
            GitHub
          </a>
          <span>•</span>
          <button
            @click="toggleGraphiteTheme"
            type="button"
            :title="isGraphiteTheme ? 'Default theme' : 'Graphite theme'"
            class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium transition-colors border border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-900"
            :class="{ 'border-[#3b4352] text-[#f0f2f5]': isGraphiteTheme }"
          >
            <span
              class="w-2 h-2 rounded-full transition-transform"
              :class="isGraphiteTheme ? 'bg-[#27ae60] scale-110' : 'bg-slate-300'"
            ></span>
            <span>{{ t('themeGraphite') }}</span>
          </button>
          <span>•</span>

          <div ref="dashboardButtonRef" class="relative">
            <button 
              @click.stop="toggleDashboardMenu"
              class="flex items-center gap-1 hover:text-slate-900 transition-colors font-semibold py-1 px-2 rounded-lg hover:bg-slate-100"
            >
              <span>{{ t('origDashboards') }}</span>
              <ChevronDown class="w-3.5 h-3.5 transition-transform" :class="{ 'rotate-180': isDashboardMenuOpen }" />
            </button>

            <div 
              v-if="isDashboardMenuOpen"
              class="absolute bottom-full right-0 mb-2 w-80 rounded-lg bg-white border border-slate-200 p-2 shadow-2xl z-50 animate-fade-in"
            >
              <div class="px-3 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                {{ t('origTitle') }}
              </div>
              <div class="divide-y divide-slate-100 max-h-64 overflow-y-auto mt-1">
                <a
                  v-for="st in stationsMeta"
                  :key="st.id"
                  :href="`${DASHBOARD_BASE_URL}/${st.id}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="flex items-center justify-between gap-2 p-2.5 rounded-lg hover:bg-slate-50 transition-colors text-slate-800 text-xs font-semibold group"
                >
                  <div class="min-w-0 flex-1">
                    <span class="block truncate group-hover:text-emerald-600 transition-colors">{{ getStationName(st) }}</span>
                    <span class="block text-[10px] text-slate-400 truncate">{{ getStationDesc(st) }}</span>
                  </div>
                  <ExternalLink class="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 shrink-0" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>

    <!-- Modals -->
    <AddStationModal
      :is-open="isAddModalOpen"
      @close="closeAddModal"
      @added="saveCustomStation"
    />

    <StationHistoryModal
      :station="selectedStationForHistory"
      :is-open="isHistoryModalOpen"
      :initial-tab="historyModalTab"
      :initial-subtab="historyModalSubtab"
      :initial-date="historyModalDate"
      :initial-month="historyModalMonth"
      :can-go-back-to-trends="cameFromComplexOutages"
      @close="closeHistory"
      @back-to-trends="backToComplexOutages"
      @update:tab="onModalTabChange"
      @update:subtab="onModalSubtabChange"
      @update:date="onModalDateChange"
      @update:month="onModalMonthChange"
    />

    <PwaInstallModal
      :is-open="isPwaModalOpen"
      :can-direct-install="canDirectInstall"
      @close="closePwaModal"
      @install="handleModalDirectInstall"
    />

    <PushNotificationModal
      v-if="isPushModalOpen"
      :stations="telemetries"
      @close="isPushModalOpen = false"
    />

    <ComplexOutagesModal
      v-if="isComplexOutagesModalOpen"
      :stations="telemetries"
      :initial-date="complexOutagesDate"
      @close="closeComplexOutages"
      @update:date="onComplexOutagesDateChange"
      @select-station="openHistoryFromOutages"
    />
  </div>
</template>
