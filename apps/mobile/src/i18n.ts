/**
 * The UI follows the phone's language: the first of the phone's preferred languages that LastCall has,
 * otherwise English. Strings are keyed by their English source text, so a missing entry shows English.
 * Only the chosen language's dictionary is loaded. Languages and the translation check live in
 * `i18n/languages.json` and `scripts/check-locales.mjs`.
 */
export type Locale = 'en' | 'ru' | 'es' | 'pt' | 'fr' | 'de' | 'it' | 'pl' | 'uk' | 'tr' | 'ar' | 'fa' | 'he' | 'ur' | 'hi' | 'bn' | 'id' | 'ms' | 'vi' | 'th' | 'zh-Hans' | 'zh-Hant' | 'ja' | 'ko' | 'nl' | 'ro' | 'cs' | 'el' | 'kk' | 'uz';
const LANGUAGES: readonly { code: Locale; intl: string; rtl?: true }[] = [
  { code: 'en', intl: 'en-US' },
  { code: 'ru', intl: 'ru-RU' },
  { code: 'es', intl: 'es-ES' },
  { code: 'pt', intl: 'pt-BR' },
  { code: 'fr', intl: 'fr-FR' },
  { code: 'de', intl: 'de-DE' },
  { code: 'it', intl: 'it-IT' },
  { code: 'pl', intl: 'pl-PL' },
  { code: 'uk', intl: 'uk-UA' },
  { code: 'tr', intl: 'tr-TR' },
  { code: 'ar', intl: 'ar', rtl: true },
  { code: 'fa', intl: 'fa-IR', rtl: true },
  { code: 'he', intl: 'he-IL', rtl: true },
  { code: 'ur', intl: 'ur-PK', rtl: true },
  { code: 'hi', intl: 'hi-IN' },
  { code: 'bn', intl: 'bn-BD' },
  { code: 'id', intl: 'id-ID' },
  { code: 'ms', intl: 'ms-MY' },
  { code: 'vi', intl: 'vi-VN' },
  { code: 'th', intl: 'th-TH' },
  { code: 'zh-Hans', intl: 'zh-CN' },
  { code: 'zh-Hant', intl: 'zh-TW' },
  { code: 'ja', intl: 'ja-JP' },
  { code: 'ko', intl: 'ko-KR' },
  { code: 'nl', intl: 'nl-NL' },
  { code: 'ro', intl: 'ro-RO' },
  { code: 'cs', intl: 'cs-CZ' },
  { code: 'el', intl: 'el-GR' },
  { code: 'kk', intl: 'kk-KZ' },
  { code: 'uz', intl: 'uz-UZ' },
];
// Each entry is evaluated only when chosen, so one dictionary is loaded and the rest stay unloaded.
const DICTIONARIES: Record<Exclude<Locale, 'en'>, () => Record<string, string>> = {
  'ru': () => require('./locales/ru.json'),
  'es': () => require('./locales/es.json'),
  'pt': () => require('./locales/pt.json'),
  'fr': () => require('./locales/fr.json'),
  'de': () => require('./locales/de.json'),
  'it': () => require('./locales/it.json'),
  'pl': () => require('./locales/pl.json'),
  'uk': () => require('./locales/uk.json'),
  'tr': () => require('./locales/tr.json'),
  'ar': () => require('./locales/ar.json'),
  'fa': () => require('./locales/fa.json'),
  'he': () => require('./locales/he.json'),
  'ur': () => require('./locales/ur.json'),
  'hi': () => require('./locales/hi.json'),
  'bn': () => require('./locales/bn.json'),
  'id': () => require('./locales/id.json'),
  'ms': () => require('./locales/ms.json'),
  'vi': () => require('./locales/vi.json'),
  'th': () => require('./locales/th.json'),
  'zh-Hans': () => require('./locales/zh-Hans.json'),
  'zh-Hant': () => require('./locales/zh-Hant.json'),
  'ja': () => require('./locales/ja.json'),
  'ko': () => require('./locales/ko.json'),
  'nl': () => require('./locales/nl.json'),
  'ro': () => require('./locales/ro.json'),
  'cs': () => require('./locales/cs.json'),
  'el': () => require('./locales/el.json'),
  'kk': () => require('./locales/kk.json'),
  'uz': () => require('./locales/uz.json'),
};
export const SUPPORTED_LOCALES: readonly Locale[] = LANGUAGES.map(language => language.code);
export let locale: Locale = 'en';
export let intlLocale = 'en-US';
/** Right-to-left script (Arabic, Persian, Hebrew, Urdu): the layout is mirrored. */
export let isRTL = false;
let dictionary: Record<string, string> = {};

/** Maps a BCP-47 tag (or a bare language code) to a language LastCall has. */
export function resolveLocale(tag: string | null | undefined): Locale | undefined {
  if (!tag) return undefined;
  const parts = tag.replace(/_/g, '-').split('-').map(part => part.toLowerCase());
  const language = ({ iw: 'he', in: 'id' } as Record<string, string>)[parts[0]!] ?? parts[0]!;
  if (language === 'zh') return parts.slice(1).some(part => part === 'hant' || part === 'tw' || part === 'hk' || part === 'mo') ? 'zh-Hant' : 'zh-Hans';
  return LANGUAGES.find(item => item.code === language)?.code;
}

/** Called once from the mobile entry point, before any screen evaluates its labels, with the phone's preferred languages. */
export function setLocale(tags: string | null | undefined | readonly (string | null | undefined)[]): void {
  const list = Array.isArray(tags) ? tags : [tags as string | null | undefined];
  const chosen = list.map(resolveLocale).find(Boolean) ?? 'en';
  const language = LANGUAGES.find(item => item.code === chosen)!;
  locale = language.code; intlLocale = language.intl; isRTL = !!language.rtl;
  dictionary = locale === 'en' ? {} : DICTIONARIES[locale]();
}

/** Account emails exist in English and Russian only. */
export function emailLocale(): 'en' | 'ru' { return locale === 'ru' ? 'ru' : 'en'; }

export function t(template: string, values?: Record<string, string | number>): string {
  const translated = dictionary[template] ?? template;
  if (!values) return translated;
  return translated.replace(/\{(\w+)\}/g, (match, key: string) => values[key] === undefined ? match : String(values[key]));
}
