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

/** Fixed allowlist only: never serialize arbitrary stats, SDP, IDs or app content. */
export function formatMediaDiagnostics(stats?: unknown): string[] {
  const values = stats && typeof stats === 'object' && !Array.isArray(stats) ? stats as Record<string, unknown> : {};
  const number = (key: string, unit = '', integer = false): string => {
    const value = values[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER || (integer && !Number.isInteger(value))) return '—';
    return `${value.toFixed(integer ? 0 : 1)}${unit ? ` ${unit}` : ''}`;
  };
  const codec = (key: string): string => typeof values[key] === 'string' && /^video\/(VP8|VP9|H264|H265|AV1)$/i.test(values[key]) ? values[key].slice(6).toUpperCase() : '—';
  const dimensions = (width: string, height: string): string => {
    const w = number(width, '', true), h = number(height, '', true);
    return w === '—' || h === '—' || w === '0' || h === '0' ? '—' : `${w}×${h}`;
  };
  const limitations: Record<string, string> = { none: 'нет', cpu: 'процессор', bandwidth: 'полоса связи', other: 'другое' };
  const limitation = typeof values.videoQualityLimitation === 'string' && Object.hasOwn(limitations, values.videoQualityLimitation) ? limitations[values.videoQualityLimitation] : '—';
  return [
    `RTT ${number('rttMs', 'мс')} · аудио ${number('audioBitrateKbps', 'кбит/с')} · jitter ${number('jitterMs', 'мс')} · потери ${number('packetsLost', '', true)}`,
    `Видео отправка: ${codec('videoCodec')} · ${dimensions('videoWidth', 'videoHeight')} · ${number('videoFramesPerSecond', 'кадр/с')} · ${number('videoBitrateKbps', 'кбит/с')}`,
    `Видео приём: ${codec('remoteVideoCodec')} · ${dimensions('remoteVideoWidth', 'remoteVideoHeight')} · ${number('remoteVideoFramesPerSecond', 'кадр/с')} · декодировано ${number('videoFramesDecoded', '', true)} · пропущено ${number('videoFramesDropped', '', true)}`,
    `Зависания: ${number('videoFreezeCount', '', true)} · всего ${number('videoFreezeSeconds', 'с')} · кодирование ${number('videoEncodeMs', 'мс/кадр')} · ограничение: ${limitation}`,
  ];
}
