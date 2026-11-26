import { View } from 'react-native';
import LottieView from 'lottie-react-native';
import { Image } from 'expo-image';
import { stickerSource } from '../stickers';
import type { GifRef } from '../sticker-model';

export const STICKER_SIZE = 150;

/** An animated Noto sticker, bundled in the app, shown without a bubble. */
export function StickerView({ emoji }: { emoji: string }) {
  const source = stickerSource(emoji);
  if (!source) return null;
  return <LottieView source={source as never} autoPlay loop style={{ width: STICKER_SIZE, height: STICKER_SIZE }} />;
}

/** A GIF or KLIPY sticker, loaded by the phone from KLIPY's CDN; GIFs get rounded corners, stickers none. */
export function GifView({ gif }: { gif: GifRef }) {
  const ratio = Math.min(3, Math.max(1 / 3, gif.width / gif.height));
  const width = gif.sticker ? STICKER_SIZE : Math.min(240, Math.round(220 * Math.sqrt(ratio)));
  const height = gif.sticker ? STICKER_SIZE : Math.round(width / ratio);
  return <View style={{ width, height, borderRadius: gif.sticker ? 0 : 14, overflow: 'hidden', backgroundColor: gif.sticker ? 'transparent' : '#DDE7E2' }}>
    <Image source={{ uri: gif.url }} style={{ width, height }} contentFit={gif.sticker ? 'contain' : 'cover'} autoplay transition={120} />
  </View>;
}
