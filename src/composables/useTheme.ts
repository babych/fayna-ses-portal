import { ref, readonly } from 'vue';

const isGraphite = ref(false);

if (typeof localStorage !== 'undefined') {
  isGraphite.value = localStorage.getItem('fayna_theme') === 'graphite';
  if (typeof document !== 'undefined' && isGraphite.value) {
    document.documentElement.setAttribute('data-theme', 'graphite');
  }
}

export function useTheme() {
  const toggleGraphiteTheme = () => {
    isGraphite.value = !isGraphite.value;
    if (typeof document !== 'undefined') {
      if (isGraphite.value) {
        document.documentElement.setAttribute('data-theme', 'graphite');
        localStorage.setItem('fayna_theme', 'graphite');
      } else {
        document.documentElement.removeAttribute('data-theme');
        localStorage.removeItem('fayna_theme');
      }
    }
  };

  return {
    isGraphite: readonly(isGraphite),
    toggleGraphiteTheme,
  };
}
