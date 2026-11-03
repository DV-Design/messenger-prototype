import { t } from './i18n';
import * as Crypto from 'expo-crypto';
import { MediaStream as NativeMediaStream, mediaDevices, RTCPeerConnection as NativePeerConnection } from 'react-native-webrtc';
import { PeerSession } from '@messenger/core';

type SessionOptions = ConstructorParameters<typeof PeerSession>[0];
type NativeConfiguration = ConstructorParameters<typeof NativePeerConnection>[0];
type NativeConstraints = Parameters<typeof mediaDevices.getUserMedia>[0];

// Native WebRTC implements the browser EventTarget API, but its public TypeScript
// types differ from lib.dom for MediaStream and event overloads.
export const nativeRtc: Pick<SessionOptions, 'rtcFactory' | 'getUserMedia' | 'randomBytes' | 'createMediaStream'> = {
  randomBytes: length => Crypto.getRandomBytes(length),
  rtcFactory: configuration => new NativePeerConnection(configuration as NativeConfiguration) as unknown as RTCPeerConnection,
  getUserMedia: async constraints => await mediaDevices.getUserMedia(constraints as NativeConstraints) as unknown as MediaStream,
  createMediaStream: tracks => new NativeMediaStream(tracks as unknown as ConstructorParameters<typeof NativeMediaStream>[0]) as unknown as MediaStream,
};

export function validateServerUrl(input: string): string {
  const url = new URL(input.trim());
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const local = host === 'localhost' || host === '::1' || host.endsWith('.local')
    || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error(t('Enter an HTTP(S) address without a password, query or fragment.'));
  }
  if (url.protocol !== 'https:' && !((__DEV__ || process.env.EXPO_PUBLIC_ALLOW_LOCAL_HTTP === '1') && local)) {
    throw new Error(t('HTTPS is required. Local HTTP is allowed only in a test build.'));
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}
