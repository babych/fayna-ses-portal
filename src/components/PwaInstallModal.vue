<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { X, Download, Smartphone, Monitor, Apple, CheckCircle2, ArrowRight } from 'lucide-vue-next';

const { t } = useI18n();

const props = defineProps<{
  isOpen: boolean;
  canDirectInstall: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'install'): void;
}>();

// Detect user platform by default
const userPlatform = computed<'ios' | 'android' | 'desktop'>(() => {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  return 'desktop';
});

const activeTab = ref<'ios' | 'android' | 'desktop'>('desktop');

// Set device tab on modal open
import { watch } from 'vue';
watch(() => props.isOpen, (open) => {
  if (open) {
    activeTab.value = userPlatform.value;
  }
});
</script>

<template>
  <div 
    v-if="isOpen"
    @click.self="emit('close')"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-fade-in"
  >
    <div class="relative w-full max-w-lg rounded-xl bg-white border border-slate-200 p-6 sm:p-8 shadow-2xl overflow-hidden">
      <!-- Close -->
      <button 
        @click="emit('close')"
        class="absolute top-5 right-5 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
      >
        <X class="w-5 h-5" />
      </button>

      <!-- Header -->
      <div class="flex items-center gap-3 mb-5">
        <div class="p-3 rounded-lg bg-emerald-50 text-emerald-600">
          <Download class="w-6 h-6" />
        </div>
        <div>
          <h2 class="text-xl font-extrabold text-slate-900 tracking-tight">{{ t('pwaModal.title') }}</h2>
          <p class="text-xs text-slate-500 mt-0.5">{{ t('pwaModal.subtitle') }}</p>
        </div>
      </div>

      <!-- Direct install button (if supported) -->
      <div v-if="canDirectInstall" class="mb-5 p-4 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3">
        <div>
          <span class="block text-xs font-bold text-emerald-900">{{ t('pwaModal.directAvailable') }}</span>
          <span class="text-[11px] text-emerald-700">{{ t('pwaModal.directSub') }}</span>
        </div>
        <button
          @click="emit('install')"
          class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/20 whitespace-nowrap"
        >
          {{ t('installApp') }}
        </button>
      </div>

      <!-- Device tabs (iOS / Android / Desktop) -->
      <div class="flex items-center p-1 rounded-lg bg-slate-100 border border-slate-200 mb-5">
        <button
          @click="activeTab = 'ios'"
          class="flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5"
          :class="activeTab === 'ios' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'"
        >
          <Apple class="w-3.5 h-3.5" />
          <span>iOS / Safari</span>
        </button>
        <button
          @click="activeTab = 'android'"
          class="flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5"
          :class="activeTab === 'android' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'"
        >
          <Smartphone class="w-3.5 h-3.5" />
          <span>Android</span>
        </button>
        <button
          @click="activeTab = 'desktop'"
          class="flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5"
          :class="activeTab === 'desktop' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'"
        >
          <Monitor class="w-3.5 h-3.5" />
          <span>Windows / Mac</span>
        </button>
      </div>

      <!-- Guide: iOS Safari -->
      <div v-if="activeTab === 'ios'" class="space-y-3 py-1">
        <div class="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
          <span class="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
          <p class="text-xs text-slate-700 leading-relaxed" v-html="t('pwaModal.iosStep1')"></p>
        </div>
        <div class="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
          <span class="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">2</span>
          <p class="text-xs text-slate-700 leading-relaxed" v-html="t('pwaModal.iosStep2')"></p>
        </div>
        <div class="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
          <span class="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">3</span>
          <p class="text-xs text-slate-700 leading-relaxed" v-html="t('pwaModal.iosStep3')"></p>
        </div>
      </div>

      <!-- Guide: Android Chrome -->
      <div v-else-if="activeTab === 'android'" class="space-y-3 py-1">
        <div class="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
          <span class="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
          <p class="text-xs text-slate-700 leading-relaxed" v-html="t('pwaModal.androidStep1')"></p>
        </div>
        <div class="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
          <span class="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">2</span>
          <p class="text-xs text-slate-700 leading-relaxed" v-html="t('pwaModal.androidStep2')"></p>
        </div>
        <div class="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
          <span class="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">3</span>
          <p class="text-xs text-slate-700 leading-relaxed" v-html="t('pwaModal.androidStep3')"></p>
        </div>
      </div>

      <!-- Guide: Desktop (Chrome / Edge / Safari) -->
      <div v-else class="space-y-3 py-1">
        <div class="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
          <span class="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
          <p class="text-xs text-slate-700 leading-relaxed" v-html="t('pwaModal.desktopStep1')"></p>
        </div>
        <div class="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
          <span class="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">2</span>
          <p class="text-xs text-slate-700 leading-relaxed" v-html="t('pwaModal.desktopStep2')"></p>
        </div>
        <div class="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
          <span class="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">3</span>
          <p class="text-xs text-slate-700 leading-relaxed" v-html="t('pwaModal.desktopStep3')"></p>
        </div>
      </div>

      <!-- "Got it" button -->
      <div class="mt-6 pt-4 border-t border-slate-100 flex justify-end">
        <button
          @click="emit('close')"
          class="px-5 py-2.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-xs font-bold transition-all shadow-xs"
        >
          {{ t('pwaModal.gotIt') }}
        </button>
      </div>
    </div>
  </div>
</template>
