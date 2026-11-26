// Copied from File Preview (plugin/editor/core/i18n.ts, MIT, Copyright (c) 2026 won geon) so this plugin
// installs on its own; used here under GPL-3.0-or-later (MIT is GPL-compatible).
/** Korean when Orca's UI language is Korean, English otherwise. */
export function makeTr(locale: string | undefined): (ko: string, en: string) => string {
  const ko = (locale ?? '').toLowerCase().startsWith('ko')
  return (k, e) => (ko ? k : e)
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
