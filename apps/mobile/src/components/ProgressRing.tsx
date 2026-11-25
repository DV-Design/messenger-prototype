import { View } from 'react-native';

/**
 * Playback progress drawn around a video circle, clockwise from the top, as Telegram does. Built from
 * two clipped half rings (no SVG): a half ring with its top and right borders coloured covers the
 * angles [r - 45°, r + 135°] when rotated by r, so r = 360°·p - 135° fills each half up to p.
 */
export function ProgressRing({ size, width, progress, color = '#FFFFFF', track = 'rgba(255,255,255,0.28)' }: { size: number; width: number; progress: number; color?: string; track?: string }) {
  const p = Math.max(0, Math.min(1, progress));
  const half = (value: number, left: boolean) => <View style={{ position: 'absolute', top: 0, left: left ? 0 : size / 2, width: size / 2, height: size, overflow: 'hidden' }}>
    <View style={{ position: 'absolute', top: 0, left: left ? 0 : -size / 2, width: size, height: size, borderRadius: size / 2, borderWidth: width,
      borderTopColor: color, borderRightColor: color, borderBottomColor: 'transparent', borderLeftColor: 'transparent',
      transform: [{ rotate: `${360 * value - 135}deg` }] }} />
  </View>;
  return <View pointerEvents="none" accessible={false} style={{ position: 'absolute', top: 0, left: 0, width: size, height: size }}>
    <View style={{ position: 'absolute', top: 0, left: 0, width: size, height: size, borderRadius: size / 2, borderWidth: width, borderColor: track }} />
    {p > 0 && half(Math.min(p, 0.5), false)}
    {p > 0.5 && half(p, true)}
  </View>;
}
