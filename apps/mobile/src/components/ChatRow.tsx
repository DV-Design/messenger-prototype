import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { MessengerFile, MessengerMessage, ReactionEmoji, ReactionView } from '@messenger/core';
import { t } from '../i18n';
import { colors, styles } from '../styles';
import { messageParts } from '../message-links';
import { deliveryColor, deliveryIcon, deliveryLabel } from '../delivery-model';
import { parseContactText, parseLocationText } from '../location-contact';
import { parseReplyText, type ParsedReply } from '../reply';
import { myReaction, nextReaction } from '../reaction-model';
import { AttachmentCard } from './AttachmentCard';
import { ContactCard, LocationCard } from './LocationContactCard';
import { ReactionBar } from './Reactions';
import { ReplyChip } from './ReplyChip';
import { SwipeToReply } from './SwipeToReply';
import { Icon, time } from './ui';

type Record = { id: string; type: 'message' | 'file'; author: string };

/** What a row can ask the chat screen to do. The screen swaps in fresh closures every render. */
export interface ChatRowActions {
  selectMessage: (item: MessengerMessage) => void;
  selectFile: (file: MessengerFile) => void;
  replyToMessage: (item: MessengerMessage) => void;
  replyToFile: (file: MessengerFile) => void;
  react: (record: Record, emoji: ReactionEmoji | undefined) => void;
  openLocation: (messageId: string) => void;
  openLink: (url: string) => void;
  scrollToQuoted: (reply: ParsedReply) => void;
  openFile: (file: MessengerFile) => void;
}

/**
 * One stable object per chat screen, so memoized rows never re-render just because the screen
 * did (a keystroke, a snapshot tick); rows always call the newest closures through it.
 */
export class ChatRowHandlers {
  private actions?: ChatRowActions;
  update(actions: ChatRowActions) { this.actions = actions; }
  get act(): ChatRowActions {
    if (!this.actions) throw new Error('Chat row actions are not ready');
    return this.actions;
  }
}

/** `names` covers the people in this row's reactions; it is part of `version`, so a rename shows through. */
interface Shared { handlers: ChatRowHandlers; selfId?: string; group: boolean; blocked: Set<string>; swipe: boolean; names: Readonly<Partial<globalThis.Record<string, string>>>; version: string }

function Reactions({ record, reactions, own, handlers, selfId, blocked, names }: { record: Record; reactions: ReactionView[] | undefined; own: boolean; handlers: ChatRowHandlers; selfId?: string; blocked: Set<string>; names: Shared['names'] }) {
  return <ReactionBar reactions={reactions} selfId={selfId} blocked={blocked} own={own} names={userId => names[userId] ?? t('Member')}
    onChoose={emoji => handlers.act.react(record, nextReaction(myReaction(reactions, selfId), emoji))} />;
}

/** `version` is the only thing compared: the screen derives it from everything the row shows. */
const sameVersion = (a: { version: string }, b: { version: string }) => a.version === b.version;

export const MessageRow = memo(function MessageRow({ item, sender, quote, translation, handlers, selfId, group, blocked, swipe, names }: Shared & {
  item: MessengerMessage; sender: string; quote?: { authorName: string; text: string }; translation?: string;
}) {
  const own = item.from === selfId;
  const expired = item.status === 'expired';
  const label = deliveryLabel(item, group);
  const reply = parseReplyText(item.text);
  const body = reply ? reply.text : item.text;
  const location = parseLocationText(body);
  const contact = !location ? parseContactText(body) : undefined;
  const select = () => handlers.act.selectMessage(item);
  return <SwipeToReply enabled={swipe} onReply={() => handlers.act.replyToMessage(item)}>
    <Pressable accessibilityHint={t('Hold to reply, react, edit, copy or delete')} accessibilityActions={[{ name: 'longpress', label: t('Message actions') }]} onAccessibilityAction={select} onLongPress={select} style={[styles.bubble, own && styles.bubbleSelf]}>
      {group && !own && <Text style={styles.senderName}>{sender}</Text>}
      {reply && quote && <ReplyChip own={own} {...quote} onPress={() => handlers.act.scrollToQuoted(reply)} />}
      {location ? <LocationCard location={location} updatedAt={item.editedAt ?? item.timestamp} onOpen={() => handlers.act.openLocation(item.id)} />
        : contact ? <ContactCard contact={contact} />
          : <Text style={styles.message}>{messageParts(translation ?? body).map((part, index) => part.url
            ? <Text key={index} accessibilityRole="link" style={{ color: colors.blue, textDecorationLine: 'underline' }} onLongPress={select} onPress={() => handlers.act.openLink(part.url!)}>{part.text}</Text>
            : part.text)}</Text>}
      {own && (group || expired) && <Text style={[styles.fileMeta, expired && { color: '#A33535' }]}>{label}</Text>}
      <View style={styles.messageMeta}>
        {!!translation && <Text style={styles.messageTime}>{t('translated')}</Text>}
        {!!item.editedAt && <Text style={styles.messageTime}>{t('edited')}</Text>}
        <Text style={styles.messageTime}>{time(item.timestamp)}</Text>
        {own && <View accessibilityLabel={label}><Icon name={deliveryIcon(item)} size={15} color={deliveryColor(item)} /></View>}
      </View>
      <Reactions record={{ id: item.id, type: 'message', author: item.from }} reactions={item.reactions} own={own} handlers={handlers} selfId={selfId} blocked={blocked} names={names} />
    </Pressable>
  </SwipeToReply>;
}, sameVersion);

export const FileRow = memo(function FileRow({ file, sender, mediaDisabled, handlers, selfId, group, blocked, swipe, names }: Shared & {
  file: MessengerFile; sender?: string; mediaDisabled: boolean;
}) {
  const self = file.senderId === selfId;
  return <SwipeToReply enabled={swipe} onReply={() => handlers.act.replyToFile(file)}>
    <View style={{ marginTop: 9 }}>
      <AttachmentCard file={file} self={self} group={group} sender={sender} mediaDisabled={mediaDisabled} onOpen={() => handlers.act.openFile(file)} onLongPress={() => handlers.act.selectFile(file)} />
      <Reactions record={{ id: file.id, type: 'file', author: file.senderId }} reactions={file.reactions} own={self} handlers={handlers} selfId={selfId} blocked={blocked} names={names} />
    </View>
  </SwipeToReply>;
}, sameVersion);

/** Everything a row renders, as one string: if it is unchanged, the row is skipped. */
export function rowVersion(record: MessengerMessage | MessengerFile, extra: unknown[]): string {
  // In-memory file bytes never go into the key: they are large and the blob key already identifies them.
  return JSON.stringify([record, ...extra], (key, value: unknown) => key === 'data' ? undefined : value);
}
