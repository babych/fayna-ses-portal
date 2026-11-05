<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Bell, BellOff, Check, X, ShieldCheck, AlertTriangle } from 'lucide-vue-next';
import { useWebPush } from '@/composables/useWebPush';
import { useStationI18n } from '@/composables/useStationI18n';
import type { StationTelemetry } from '@/types/models';

const props = defineProps<{
  stations: StationTelemetry[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();
const { getStationName } = useStationI18n();
const { isSupported, isSubscribed, currentScope, loading, error, subscribe, unsubscribe } = useWebPush();

const selectedScope = ref<string>(currentScope.value || 'all');
const successMessage = ref(false);

watch(currentScope, (newScope) => {
  if (newScope) selectedScope.value = newScope;
}, { immediate: true });

const handleSave = async () => {
  const ok = await subscribe(selectedScope.value);
  if (ok) {
    successMessage.value = true;
    setTimeout(() => {
      successMessage.value = false;
      emit('close');
    }, 1500);
  }
};

const handleDisable = async () => {
  const ok = await unsubscribe();
  if (ok) {
    emit('close');
  }
};
</script>

<template>
  <div 
    @click.self="emit('close')"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
  >
    <div class="relative w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 overflow-hidden">
      <!-- Header -->
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200">
            <Bell class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-base font-extrabold text-slate-900 tracking-tight">
              {{ t('pushModal.title') }}
            </h3>
            <p class="text-xs text-slate-700">
              {{ t('pushModal.subtitle') }}
            </p>
          </div>
        </div>

        <button
          @click="emit('close')"
          class="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <!-- Unsupported notice with iOS Step-by-Step Guide -->
      <div v-if="!isSupported" class="mt-5 space-y-4">
        <div class="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
          <AlertTriangle class="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p class="leading-relaxed">{{ t('pushModal.unsupported') }}</p>
        </div>

        <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-slate-700 text-xs space-y-2.5">
          <p class="font-extrabold text-slate-900 flex items-center gap-1.5">
            <span>📱</span> {{ t('pushModal.iosGuideTitle') }}
          </p>
          <div class="space-y-1.5 text-slate-600 pl-1 leading-relaxed">
            <p v-html="t('pushModal.iosStep1')"></p>
            <p v-html="t('pushModal.iosStep2')"></p>
            <p v-html="t('pushModal.iosStep3')"></p>
          </div>
        </div>

        <button
          @click="emit('close')"
          class="w-full py-2.5 px-4 rounded-2xl bg-slate-900 text-white font-extrabold text-xs hover:bg-slate-800 transition-colors"
        >
          {{ t('close') }}
        </button>
      </div>

      <!-- Main Config Body -->
      <div v-else class="mt-5 space-y-4">
        <!-- Anti-Spam Guarantee Badge -->
        <div class="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
          <ShieldCheck class="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div class="text-xs text-emerald-900 leading-relaxed font-medium">
            <strong>{{ t('pushModal.antiSpamTitle') }}</strong>: {{ t('pushModal.antiSpamDesc') }}
          </div>
        </div>

        <!-- Scope Selection -->
        <div class="space-y-2">
          <label class="text-xs font-bold text-slate-700 uppercase tracking-wider block">
            {{ t('pushModal.scopeLabel') }}
          </label>

          <div class="space-y-2 max-h-52 overflow-y-auto pr-1">
            <!-- Whole complex option -->
            <label
              class="flex items-center justify-between p-3 rounded-2xl border cursor-pointer transition-all"
              :class="selectedScope === 'all' ? 'border-emerald-500 bg-emerald-50/50 text-emerald-950 font-bold' : 'border-slate-200 hover:bg-slate-50 text-slate-700'"
            >
              <div class="flex items-center gap-3">
                <input
                  type="radio"
                  name="push-scope"
                  value="all"
                  v-model="selectedScope"
                  class="w-4 h-4 text-emerald-600 focus:ring-emerald-500 border-slate-300"
                />
                <span class="text-xs">{{ t('pushModal.allComplex') }}</span>
              </div>
              <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-500">
                1 {{ t('pushModal.pushPerEvent') }}
              </span>
            </label>

            <!-- Specific Buildings -->
            <label
              v-for="st in stations"
              :key="st.id"
              class="flex items-center justify-between p-3 rounded-2xl border cursor-pointer transition-all"
              :class="selectedScope === st.id ? 'border-emerald-500 bg-emerald-50/50 text-emerald-950 font-bold' : 'border-slate-200 hover:bg-slate-50 text-slate-700'"
            >
              <div class="flex items-center gap-3 min-w-0 pr-2">
                <input
                  type="radio"
                  name="push-scope"
                  :value="st.id"
                  v-model="selectedScope"
                  class="w-4 h-4 text-emerald-600 focus:ring-emerald-500 border-slate-300 shrink-0"
                />
                <span class="text-xs truncate">{{ getStationName(st) }}</span>
              </div>
            </label>
          </div>
        </div>

        <!-- Error display -->
        <div v-if="error" class="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <AlertTriangle class="w-4 h-4 text-rose-600 shrink-0" />
          <span>{{ error }}</span>
        </div>

        <!-- Actions -->
        <div class="pt-2 flex items-center gap-2">
          <button
            @click="handleSave"
            :disabled="loading"
            class="flex-1 py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Check v-if="successMessage" class="w-4 h-4" />
            <Bell v-else class="w-4 h-4" />
            <span>{{ successMessage ? t('pushModal.saved') : (isSubscribed ? t('pushModal.update') : t('pushModal.enable')) }}</span>
          </button>

          <button
            v-if="isSubscribed"
            @click="handleDisable"
            :disabled="loading"
            class="py-3 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-all flex items-center gap-1.5"
            :title="t('pushModal.disable')"
          >
            <BellOff class="w-4 h-4 text-slate-600" />
            <span>{{ t('pushModal.disable') }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
