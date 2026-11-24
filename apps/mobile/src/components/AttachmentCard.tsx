import { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { MessengerFile } from '@messenger/core';
import { colors, styles } from '../styles';
import { Icon, fileSize } from './ui';
import { t } from '../i18n';
import { client } from '../runtime';
import { deliveryColor, deliveryIcon, deliveryLabel } from '../delivery-model';
import { mediaKind } from '../media-model';
import { viewerKind } from '../media-viewer-model';
import { MediaAttachment } from './MediaAttachment';
import { useAfterTransition } from '../after-transition';
import { cachedPreview, rememberPreview } from '../preview-cache';

export function AttachmentCard({ file, self, group = false, sender, onOpen, onLongPress, mediaDisabled = false }: { file: MessengerFile; self: boolean; group?: boolean; sender?: string; onOpen: () => void; onLongPress?: () => void; mediaDisabled?: boolean }) {
  const [preview, setPreview] = useState<{ key: string; uri: string }>();
  const { id, senderId, conversationId, data, mime, blobKey, deliveryStatus } = file;
  const previewKey = `${conversationId}:${senderId}:${id}:${blobKey ?? ''}`;
  const ready = useAfterTransition();
  useEffect(() => {
    if (!ready || (!data && !blobKey) || !mime.startsWith('image/') || deliveryStatus === 'expired') return;
    const known = cachedPreview(previewKey);
    // Already decrypted earlier in this foreground session: show it without touching the blob again.
    if (known) { void Promise.resolve().then(() => setPreview({ key: previewKey, uri: known })); return; }
    let canceled = false;
    const current = client();
    const suffix = Array.from(Crypto.getRandomBytes(8), value => value.toString(16).padStart(2, '0')).join('');
    const temporary = new File(Paths.cache, `lastcall-preview-${suffix}`);
    void Promise.resolve(data ?? current.getFileData(conversationId, id, senderId)).then(async bytes => {
      if (!bytes || canceled || client() !== current) return;
      await temporary.write(bytes);
      if (canceled) { if (temporary.exists) temporary.delete(); return; }
      rememberPreview(previewKey, temporary.uri);
      setPreview({ key: previewKey, uri: temporary.uri });
    }).catch(() => {});
    return () => { canceled = true; };
  }, [ready, id, senderId, conversationId, data, mime, blobKey, deliveryStatus, previewKey]);
  // A large file is a plain file in app storage: the sender always has it, the recipient once it is complete.
  const available = file.large ? (self || file.status === 'complete') && file.deliveryStatus !== 'expired' : !!(file.data || file.blobKey) && file.deliveryStatus !== 'expired';
  // Announced through the server; the bytes come directly from the sender's phone.
  const waiting = !self && !!file.waiting;
  // Read once per mount: a waiting file stays on screen for days, a re-render later picks up the deadline.
  const [shownAt] = useState(() => Date.now());
  const late = waiting && !!file.expiresAt && file.expiresAt <= shownAt;
  const label = self ? deliveryLabel(file, group) : waiting ? (late ? t('Could not receive') : t('Waiting for the sender')) : file.status === 'receiving' ? t('Receiving…') : file.status === 'error' ? t('Could not receive') : t('Received');
  const note = mediaKind(file.name, file.mime);
  const receipt = self ? <View accessibilityLabel={label}><Icon name={deliveryIcon(file)} size={15} color={deliveryColor(file)} /></View> : null;
  if (note && available && !file.large) return <Pressable accessibilityHint={t('Hold to delete')} onLongPress={onLongPress} style={[styles.bubble, self && styles.bubbleSelf]}>
    {!!sender && !self && <Text style={styles.senderName}>{sender}</Text>}
    {receipt}
    <MediaAttachment file={file} kind={note} disabled={mediaDisabled} />
    <View style={[styles.row, { justifyContent: 'space-between', marginTop: 7 }]}><Text style={styles.fileMeta}>{fileSize(file.size)} · {label}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('Save recording')} onPress={onOpen} hitSlop={10}><Icon name="share-outline" size={20} /></Pressable></View>
  </Pressable>;
  return <Pressable accessibilityRole="button" accessibilityLabel={t('File {name}. {label}', { name: file.name, label })} disabled={!available && !onLongPress} onPress={available ? onOpen : undefined} onLongPress={onLongPress} style={[styles.bubble, self && styles.bubbleSelf]}>
    {!!sender && !self && <Text style={styles.senderName}>{sender}</Text>}
    {receipt}
    {available && preview?.key === previewKey && <Image source={{ uri: preview.uri }} style={styles.previewImage} resizeMode="cover" />}
    <View style={styles.row}><Icon name={waiting ? 'time-outline' : file.mime.startsWith('video/') ? 'videocam-outline' : file.mime.startsWith('image/') ? 'image-outline' : 'document-text-outline'} size={25} /><View><Text numberOfLines={2} style={styles.fileName}>{file.name}</Text><Text style={styles.fileMeta}>{fileSize(file.size)} · {label}</Text>
      {file.large && <Text style={styles.fileMeta}>{t('Large file · directly to the phone, stored without LastCall encryption')}</Text>}
      {waiting && <Text style={styles.fileMeta}>{late ? t('The sender’s phone did not come online in time') : t('Arrives as soon as the sender’s phone is online')}</Text>}
      {file.status === 'receiving' && !waiting && <Text style={styles.fileMeta}>{transferText(file.receivedBytes, file.size)}</Text>}
      {self && file.large && file.deliveryStatus !== 'delivered' && file.deliveryStatus !== 'expired' && file.receivedBytes > 0 && <Text style={styles.fileMeta}>{t('Sending')} · {transferText(file.receivedBytes, file.size)}</Text>}
      {available && <Text style={[styles.fileMeta, { color: colors.accent }]}> {viewerKind(file) ? t('Tap to view') : t('Tap to open or save')}</Text>}
    </View></View>
  </Pressable>;
}

/** "37% · 380 MB of 1 GB" — large files take minutes, so the bytes matter as much as the percent. */
function transferText(done: number, size: number): string {
  const percent = Math.min(100, Math.floor(done / Math.max(1, size) * 100));
  return size > 5 * 1024 * 1024 ? `${percent}% · ${fileSize(done)} / ${fileSize(size)}` : `${percent}%`;
}
