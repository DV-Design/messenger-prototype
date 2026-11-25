/**
 * Length in seconds of an MP4/M4A recording, read from its movie header ("mvhd": timescale and
 * duration), so a voice message or circle shows 0:36 instead of its size without being played.
 */
export function mp4Duration(bytes: Uint8Array): number | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 4; i + 4 <= bytes.length; i++) {
    if (bytes[i] !== 0x6d || bytes[i + 1] !== 0x76 || bytes[i + 2] !== 0x68 || bytes[i + 3] !== 0x64) continue;
    const version = bytes[i + 4];
    let timescale: number; let duration: number;
    if (version === 1) {
      if (i + 36 > bytes.length) return undefined;
      timescale = view.getUint32(i + 24); duration = view.getUint32(i + 28) * 2 ** 32 + view.getUint32(i + 32);
    } else {
      if (i + 24 > bytes.length) return undefined;
      timescale = view.getUint32(i + 16); duration = view.getUint32(i + 20);
    }
    if (!timescale || duration === 0xffffffff) return undefined;
    const seconds = duration / timescale;
    return Number.isFinite(seconds) && seconds > 0 && seconds < 24 * 3600 ? seconds : undefined;
  }
  return undefined;
}
