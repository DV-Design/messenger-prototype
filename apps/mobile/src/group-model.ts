import type { Conversation, DirectoryUser } from '@messenger/core';

export const MAX_GROUP_MEMBERS = 8;
export interface GroupMemberView { user: DirectoryUser; self: boolean; owner: boolean }

/**
 * WhatsApp order: you first, then everyone else by name; the owner is marked, not moved.
 * A member this phone has no profile for yet still shows up, so the list never hides anyone.
 */
export function groupMembersView(group: Pick<Conversation, 'memberIds' | 'creatorId'>, contacts: readonly DirectoryUser[], own: string, ownName: string, unknownName = 'Member'): GroupMemberView[] {
  const view = group.memberIds.map(userId => {
    const self = userId === own;
    const contact = contacts.find(item => item.userId === userId);
    const user: DirectoryUser = contact ?? { userId, publicKey: '', username: '', displayName: self ? ownName : unknownName, online: false, lastSeen: 0 };
    return { user, self, owner: userId === group.creatorId };
  });
  return view.sort((a, b) => a.self !== b.self ? (a.self ? -1 : 1) : a.user.displayName.localeCompare(b.user.displayName));
}
