/**
 * One Intl.DateTimeFormat per locale and option set. `toLocaleTimeString` and friends build a new
 * formatter on every call, which on Android goes through ICU each time; a chat formats a time for
 * every visible message, so the formatters are kept.
 */
const formats = new Map<string, Intl.DateTimeFormat>();

export function formatDate(timestamp: number, locale: string, options: Intl.DateTimeFormatOptions): string {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = formats.get(key);
  if (!format) { format = new Intl.DateTimeFormat(locale, options); formats.set(key, format); }
  return format.format(timestamp);
}
