import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Contacts from 'expo-contacts';
import { clearDiscovery, configureDiscovery, syncDiscovery, useDiscovery } from '../discovery';
import { client, useMessenger } from '../runtime';
export function DiscoveryBridge() {
  const { profile, identity, snapshot } = useMessenger();
  const { enabled } = useDiscovery();
  useEffect(() => {
    if (!profile || !identity) return;
    void configureDiscovery(profile.serverUrl, identity.userId, client()).catch(() => {});
    return () => clearDiscovery();
  }, [profile, identity]);
  useEffect(() => {
    if (!enabled) return;
    const resume = AppState.addEventListener('change', value => { if (value === 'active') void syncDiscovery(true); });
    // Reading contacts remains guarded by the permission check in syncDiscovery.
    const changes = Contacts.addContactsChangeListener(() => { void syncDiscovery(true); });
    if (snapshot.status === 'online') void syncDiscovery(true);
    return () => { resume.remove(); changes.remove(); };
  }, [enabled, snapshot.status]);
  return null;
}
