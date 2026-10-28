/** Diagnostics are manually shared; never include private app content. */
export function sanitizeDiagnostic(value: string | undefined, privateValues: readonly string[]): string {
  let result = value ?? '—';
  for (const item of [...new Set(privateValues.filter(Boolean))].sort((a, b) => b.length - a.length)) {
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'giu'), '[скрыто]');
  }
  return result.replace(/\b[a-f0-9]{32,}\b/gi, '[id]')
    .replace(/\+?\d[\d ()-]{7,}\d/g, '[номер]')
    .replace(/@[a-z0-9_]{3,24}/gi, '[@user]').replace(/[\r\n]+/g, ' ').slice(0, 500);
}
