export type Preferences = { model: string; search: boolean; textSize: 'standard' | 'large'; motion: 'system' | 'reduced' };
export const defaults: Preferences = { model: 'uvms-1-balanced', search: false, textSize: 'standard', motion: 'system' };
export function readPreferences(): Preferences {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem('uvms-preferences') || '{}') }; } catch { return defaults; }
}
export function savePreferences(value: Preferences) {
  localStorage.setItem('uvms-preferences', JSON.stringify(value));
  window.dispatchEvent(new Event('uvms-preferences'));
}
