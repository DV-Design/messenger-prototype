/** Pure parts of chat translation: when a message needs it, and a bounded cache. */
export const baseLanguage = (tag: string) => tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';

/** "und" (not recognized) and text already in my language are shown as written. */
export function needsTranslation(detected: string, target: string): boolean {
  const source = baseLanguage(detected);
  return !!source && source !== 'und' && source !== baseLanguage(target);
}

/** Text worth sending to the translator: links, emoji and numbers alone are left as they are. */
export function translatable(text: string): boolean {
  const words = text.replace(/https?:\/\/\S+/gi, ' ').replace(/[\p{N}\p{P}\p{S}\p{Extended_Pictographic}\s]+/gu, ' ').trim();
  return words.length >= 2;
}

export class TranslationCache<V> {
  private readonly items = new Map<string, V>();
  constructor(private readonly limit = 500) {}
  get(key: string): V | undefined {
    const value = this.items.get(key);
    if (value !== undefined) { this.items.delete(key); this.items.set(key, value); }
    return value;
  }
  set(key: string, value: V) {
    this.items.delete(key); this.items.set(key, value);
    while (this.items.size > this.limit) this.items.delete(this.items.keys().next().value!);
  }
  has(key: string) { return this.items.has(key); }
}

export const translationKey = (target: string, text: string) => `${baseLanguage(target)}\u0000${text}`;
