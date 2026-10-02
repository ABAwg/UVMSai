export function toast(message: string, kind: 'success' | 'error' | 'warning' | 'info' = 'success') {
  window.dispatchEvent(new CustomEvent('uvms-toast', { detail: { message, kind } }));
}
export async function copyText(value: string) {
  try { await navigator.clipboard.writeText(value); toast('Copied to clipboard.'); }
  catch { toast('Clipboard access was denied. Select the text to copy it.', 'error'); }
}
