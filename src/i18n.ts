import { createI18n } from 'vue-i18n';
import uk from './locales/uk.json';
import en from './locales/en.json';

// Automatic language detection: query param -> localStorage -> browser locale
function detectLanguage(): string {
  if (typeof window !== 'undefined') {
    const urlLang = new URLSearchParams(window.location.search).get('lang');
    if (urlLang === 'uk' || urlLang === 'en') {
      localStorage.setItem('fayna_ses_locale', urlLang);
      document.documentElement.lang = urlLang;
      return urlLang;
    }
  }

  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('fayna_ses_locale') : null;
  if (saved === 'uk' || saved === 'en') {
    if (typeof document !== 'undefined') document.documentElement.lang = saved;
    return saved;
  }
  const browserLang = (typeof navigator !== 'undefined' ? (navigator.language || (navigator as any).userLanguage || '') : '').toLowerCase();
  const detected = browserLang.startsWith('uk') ? 'uk' : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = detected;
  return detected;
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLanguage(),
  fallbackLocale: 'en',
  messages: {
    uk,
    en,
  },
});
