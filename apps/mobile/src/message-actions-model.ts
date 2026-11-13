import type { Conversation, DirectoryUser } from '@messenger/core';
import { parseContactText, parseLocationText } from './location-contact';

export type MessageAction = 'edit' | 'copy' | 'deleteForEveryone' | 'deleteForMe';

/** Only the author can change a record for others; anyone can remove their own copy. A location or contact card has no free-text edit — a live share updates it on its own. */
export function messageActions(input: { own: boolean; type: 'message' | 'file'; expired: boolean; text?: string }): MessageAction[] {
  const actions: MessageAction[] = [];
  const card = input.text !== undefined && (!!parseLocationText(input.text) || !!parseContactText(input.text));
  if (input.own && input.type === 'message' && !input.expired && !card) actions.push('edit');
  if (input.type === 'message') actions.push('copy');
  if (input.own) actions.push('deleteForEveryone');
  actions.push('deleteForMe');
  return actions;
}

/** A person you chose: group members and people who only connected to you are not your contacts. */
export function myContacts(contacts: DirectoryUser[], conversations: Conversation[], query = ''): DirectoryUser[] {
  const search = query.trim().replace(/^@/, '').toLowerCase();
  return contacts
    .filter(user => conversations.some(item => item.kind === 'direct' && !item.implicit && item.memberIds.includes(user.userId)))
    .filter(user => !search || user.displayName.toLowerCase().includes(search) || user.username.toLowerCase().includes(search))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
