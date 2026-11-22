import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, Modal, PanResponder, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { useVideoPlayer, VideoView } from 'expo-video';
import { attachmentKey, type MessengerFile } from '@messenger/core';
import { deleteMediaCache, loadFileData } from '../attachments';
import { bulkFile } from '../bulk-files';
import { claimMediaPlayback, stopMediaPlayback } from '../media-playback';
import { viewerExtension, viewerKind, ZoomGesture, type Point } from '../media-viewer-model';
import { IconButton, time } from './ui';
import { t } from '../i18n';

/**
 * Full-screen photo or video from a chat. The decrypted copy lives in the app cache only while the
 * viewer is open (a large file is already a plain file in app storage and is read in place).
 */
export function MediaViewer({ file, title, autoPlay, onClose, onShare }: { file?: MessengerFile; title: string; autoPlay: boolean; onClose: () => void; onShare: (file: MessengerFile) => Promise<void> }) {
  const kind = file ? viewerKind(file) : undefined;
  const [source, setSource] = useState<{ key: string; uri: string }>();
  const [error, setError] = useState<{ key: string; text: string }>();
  const [chrome, setChrome] = useState(true);
  const sharing = useRef(false);
  const insets = useSafeAreaInsets();
  const key = file ? `${file.conversationId}:${file.senderId}:${file.id}` : '';

  useEffect(() => {
    if (!file || !kind) return;
    let canceled = false;
    let temporary: string | undefined;
    stopMediaPlayback();
    void (async () => {
      if (file.large) {
        const stored = bulkFile(attachmentKey(file.senderId, file.id, file.conversationId), file.name);
        if (!stored.exists) throw new Error('missing');
        return stored.uri;
      }
      const bytes = await loadFileData(file);
      if (!bytes?.byteLength) throw new Error('missing');
      const nonce = Array.from(Crypto.getRandomBytes(16), byte => byte.toString(16).padStart(2, '0')).join('');
      const copy = new File(Paths.cache, `lastcall-media-play-${nonce}.${viewerExtension(file.mime)}`);
      temporary = copy.uri;
      await copy.write(bytes);
      return copy.uri;
    })().then(uri => { if (!canceled) setSource({ key, uri }); else deleteMediaCache(temporary); })
      .catch(() => { if (!canceled) setError({ key, text: t('The file is no longer stored on this device.') }); deleteMediaCache(temporary); });
    return () => { canceled = true; deleteMediaCache(temporary); };
  }, [file, kind, key]);

  // Leaving the app closes the viewer and removes the decrypted copy, as voice notes and previews do.
  useEffect(() => {
    if (!file) return;
    const subscription = AppState.addEventListener('change', state => { if (state === 'background' && !sharing.current) onClose(); });
    return () => subscription.remove();
  }, [file, onClose]);

  if (!file || !kind) return null;
  const uri = source?.key === key ? source.uri : undefined;
  const failed = error?.key === key ? error.text : '';
  async function share() {
    if (!file || sharing.current) return;
    sharing.current = true;
    try { await onShare(file); } finally { sharing.current = false; }
  }
  return <Modal visible animationType="fade" presentationStyle="fullScreen" statusBarTranslucent navigationBarTranslucent supportedOrientations={['portrait', 'landscape']} onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {uri ? kind === 'image'
        ? <ZoomableImage key={uri} uri={uri} toggleChrome={setChrome} />
        : <ViewerVideo key={uri} uri={uri} autoPlay={autoPlay} />
        : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>{failed ? <Text style={{ color: '#FFFFFF', textAlign: 'center' }}>{failed}</Text> : <ActivityIndicator color="#FFFFFF" size="large" />}</View>}
      {(chrome || kind === 'video' || !uri) && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + 6, paddingLeft: insets.left + 6, paddingRight: insets.right + 6, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <IconButton name="close" label={t('Close')} color="#FFFFFF" onPress={onClose} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>{title}</Text>
          <Text numberOfLines={1} style={{ color: '#D0D7DB', fontSize: 13 }}>{time(file.timestamp)}</Text>
        </View>
        <IconButton name="share-outline" label={t('Save or share')} color="#FFFFFF" disabled={!uri} onPress={() => void share()} />
      </View>}
    </View>
  </Modal>;
}

function touchesOf(event: GestureResponderEvent): Point[] {
  return event.nativeEvent.touches.map(touch => ({ x: touch.pageX, y: touch.pageY }));
}

/** `toggleChrome` is a state setter, stable for the viewer's life, so the responder can keep it. */
function ZoomableImage({ uri, toggleChrome }: { uri: string; toggleChrome: (update: (shown: boolean) => boolean) => void }) {
  const { width, height } = useWindowDimensions();
  const [gesture] = useState(() => new ZoomGesture({ width, height }));
  const [values] = useState(() => ({ scale: new Animated.Value(1), x: new Animated.Value(0), y: new Animated.Value(0) }));
  useEffect(() => {
    gesture.resize({ width, height });
    values.scale.setValue(gesture.view.scale); values.x.setValue(gesture.view.x); values.y.setValue(gesture.view.y);
  }, [gesture, values, width, height]);
  const [responder] = useState(() => {
    const show = (view: { scale: number; x: number; y: number }, animate = false) => {
      if (!animate) { values.scale.setValue(view.scale); values.x.setValue(view.x); values.y.setValue(view.y); return; }
      Animated.parallel([
        Animated.timing(values.scale, { toValue: view.scale, duration: 180, useNativeDriver: true }),
        Animated.timing(values.x, { toValue: view.x, duration: 180, useNativeDriver: true }),
        Animated.timing(values.y, { toValue: view.y, duration: 180, useNativeDriver: true }),
      ]).start();
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: event => gesture.begin(touchesOf(event), Date.now()),
      onPanResponderMove: event => show(gesture.move(touchesOf(event), Date.now())),
      onPanResponderRelease: event => {
        const result = gesture.end({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }, Date.now());
        show(result.view, true);
        if (result.tap) toggleChrome(shown => !shown);
      },
      onPanResponderTerminate: event => show(gesture.end({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }, Number.MAX_SAFE_INTEGER).view, true),
    });
  });
  return <View style={{ flex: 1, overflow: 'hidden' }} {...responder.panHandlers}>
    <Animated.Image accessibilityRole="image" accessibilityLabel={t('Photo')} source={{ uri }} resizeMode="contain" style={{ width, height, transform: [{ translateX: values.x }, { translateY: values.y }, { scale: values.scale }] }} />
  </View>;
}

function ViewerVideo({ uri, autoPlay }: { uri: string; autoPlay: boolean }) {
  const player = useVideoPlayer(uri, value => { value.loop = false; value.staysActiveInBackground = false; });
  useEffect(() => {
    const release = claimMediaPlayback(() => player.pause());
    if (autoPlay && AppState.currentState === 'active') player.play();
    return release;
  }, [player, autoPlay]);
  return <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls surfaceType="textureView" allowsPictureInPicture={false} fullscreenOptions={{ enable: false }} />;
}
