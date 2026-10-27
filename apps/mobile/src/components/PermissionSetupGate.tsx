import { useEffect } from 'react';
import { router, useRootNavigationState } from 'expo-router';
import { setupComplete } from '../permissions';
import { useMessenger } from '../runtime';
let presented = false;
export function PermissionSetupGate() {
  const { profile } = useMessenger();
  const navigation = useRootNavigationState();
  useEffect(() => {
    if (!profile || presented || !navigation?.key) return;
    let active = true;
    void setupComplete().then(complete => {
      if (active && !complete && !presented) { presented = true; router.push({ pathname: '/permissions', params: { setup: '1' } }); }
    }).catch(() => { /* Settings still provides a manual entry if SecureStore is unavailable. */ });
    return () => { active = false; };
  }, [profile, navigation?.key]);
  return null;
}
