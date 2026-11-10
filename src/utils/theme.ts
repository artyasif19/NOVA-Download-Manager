import { AppSettings } from '../types/download';

/** Applies the chosen theme (dark / light / liquid glass, gradients, custom colours) to the page. */
export function applyThemeToDocument(settings: AppSettings): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', settings.theme || 'dark');
  root.setAttribute('data-glass', settings.glassStyle || 'default');
  const colors =
    settings.customColors && settings.customColors.length >= 3
      ? settings.customColors
      : ['#06b6d4', '#8b5cf6', '#f43f5e'];
  root.style.setProperty('--nova-c1', colors[0]);
  root.style.setProperty('--nova-c2', colors[1]);
  root.style.setProperty('--nova-c3', colors[2]);
  if (settings.customBgImage) root.style.setProperty('--nova-bg-image', `url("${settings.customBgImage}")`);
  else root.style.removeProperty('--nova-bg-image');
}
