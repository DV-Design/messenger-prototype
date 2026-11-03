import { t } from './i18n';

/** Diagnostics are manually shared; never include private app content. */
export function sanitizeDiagnostic(value: string | undefined, privateValues: readonly string[]): string {
  let result = value ?? '—';
  for (const item of [...new Set(privateValues.filter(Boolean))].sort((a, b) => b.length - a.length)) {
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'giu'), t('[hidden]'));
  }
  return result.replace(/\b[a-f0-9]{32,}\b/gi, '[id]')
    .replace(/\+?\d[\d ()-]{7,}\d/g, t('[number]'))
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
  const limitations: Record<string, string> = { none: t('none'), cpu: t('processor'), bandwidth: t('network bandwidth'), other: t('other') };
  const limitation = typeof values.videoQualityLimitation === 'string' && Object.hasOwn(limitations, values.videoQualityLimitation) ? (limitations[values.videoQualityLimitation] ?? '—') : '—';
  return [
    t('RTT {rtt} · audio {audio} · jitter {jitter} · loss {loss}', { rtt: number('rttMs', t('ms')), audio: number('audioBitrateKbps', t('kbps')), jitter: number('jitterMs', t('ms')), loss: number('packetsLost', '', true) }),
    t('Video send: {codec} · {dimensions} · {fps} · {bitrate}', { codec: codec('videoCodec'), dimensions: dimensions('videoWidth', 'videoHeight'), fps: number('videoFramesPerSecond', t('fps')), bitrate: number('videoBitrateKbps', t('kbps')) }),
    t('Video receive: {codec} · {dimensions} · {fps} · decoded {decoded} · dropped {dropped}', { codec: codec('remoteVideoCodec'), dimensions: dimensions('remoteVideoWidth', 'remoteVideoHeight'), fps: number('remoteVideoFramesPerSecond', t('fps')), decoded: number('videoFramesDecoded', '', true), dropped: number('videoFramesDropped', '', true) }),
    t('Freezes: {count} · total {seconds} · encode {encode} · limitation: {limit}', { count: number('videoFreezeCount', '', true), seconds: number('videoFreezeSeconds', t('s')), encode: number('videoEncodeMs', t('ms/frame')), limit: limitation }),
  ];
}
