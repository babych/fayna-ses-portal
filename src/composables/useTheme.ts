import { ref, readonly } from 'vue';

const isGraphite = ref(false);

const applyThemeToDom = (graphite: boolean) => {
  if (typeof document !== 'undefined') {
    if (graphite) {
      document.documentElement.setAttribute('data-theme', 'graphite');
      document.documentElement.classList.add('dark');
      document.documentElement.style.backgroundColor = '#16191f';
      document.body.style.backgroundColor = '#16191f';
    } else {
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.classList.remove('dark');
      document.documentElement.style.backgroundColor = '#f8fafc';
      document.body.style.backgroundColor = '#f8fafc';
    }
  }
};

if (typeof localStorage !== 'undefined') {
  const saved = localStorage.getItem('fayna_theme');
  isGraphite.value = saved === 'graphite' || (!saved && typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  applyThemeToDom(isGraphite.value);
}

export function useTheme() {
  const toggleGraphiteTheme = () => {
    isGraphite.value = !isGraphite.value;
    applyThemeToDom(isGraphite.value);
    if (typeof localStorage !== 'undefined') {
      if (isGraphite.value) {
        localStorage.setItem('fayna_theme', 'graphite');
      } else {
        localStorage.setItem('fayna_theme', 'light');
      }
    }
  };

  return {
    isGraphite: readonly(isGraphite),
    toggleGraphiteTheme,
  };
}
