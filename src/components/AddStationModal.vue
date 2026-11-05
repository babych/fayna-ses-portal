<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Plus, X, AlertCircle, CheckCircle2 } from 'lucide-vue-next';
import { extractStationId, fetchStationMetadata, fetchTodayFeed } from '@/services/api';
import type { StationMetadata } from '@/types/models';

const { t } = useI18n();

defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'added', station: StationMetadata): void;
}>();

const inputUrl = ref('');
const loading = ref(false);
const error = ref<string | null>(null);
const success = ref(false);

const handleAdd = async () => {
  error.value = null;
  const stationId = extractStationId(inputUrl.value);

  if (!stationId) {
    error.value = t('addModal.errorInvalid');
    return;
  }

  loading.value = true;
  try {
    const meta = await fetchStationMetadata(stationId);
    const feed = await fetchTodayFeed(stationId);

    // Validate telemetry feed structure from backend
    if (!feed || !Array.isArray(feed.t) || !Array.isArray(feed.soc)) {
      throw new Error('Invalid telemetry feed structure');
    }

    meta.isCustom = true;
    success.value = true;
    setTimeout(() => {
      emit('added', meta);
      inputUrl.value = '';
      success.value = false;
      loading.value = false;
      emit('close');
    }, 800);
  } catch (err: any) {
    error.value = t('addModal.errorConnect');
    loading.value = false;
  }
};
</script>

<template>
  <div 
    v-if="isOpen"
    @click.self="emit('close')"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
  >
    <div class="relative w-full max-w-lg rounded-3xl bg-white border border-slate-200 p-6 shadow-2xl">
      <button 
        @click="emit('close')"
        class="absolute top-5 right-5 p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
      >
        <X class="w-5 h-5" />
      </button>

      <div class="flex items-center gap-3 mb-4">
        <div class="p-3 rounded-2xl bg-emerald-50 text-emerald-600">
          <Plus class="w-6 h-6" />
        </div>
        <div>
          <h2 class="text-xl font-extrabold text-slate-900 tracking-tight">{{ t('addModal.title') }}</h2>
          <p class="text-xs text-slate-500 mt-0.5">{{ t('addModal.subtitle') }}</p>
        </div>
      </div>

      <div class="space-y-4">
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-2">
            {{ t('addModal.label') }}
          </label>
          <input 
            v-model="inputUrl"
            type="text"
            :placeholder="t('addModal.placeholder')"
            class="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-mono"
            @keydown.enter="handleAdd"
          />
        </div>

        <div v-if="error" class="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
          <AlertCircle class="w-4 h-4 shrink-0 mt-0.5" />
          <span>{{ error }}</span>
        </div>

        <div v-if="success" class="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 class="w-4 h-4 shrink-0" />
          <span>{{ t('addModal.success') }}</span>
        </div>

        <div class="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            @click="emit('close')"
            class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
          >
            {{ t('addModal.cancel') }}
          </button>
          <button
            type="button"
            :disabled="loading || !inputUrl.trim()"
            @click="handleAdd"
            class="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-md shadow-emerald-600/20"
          >
            <span v-if="loading" class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            <span>{{ loading ? t('addModal.checking') : t('addModal.submit') }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
