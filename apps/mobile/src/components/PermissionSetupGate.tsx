import { useEffect } from 'react';
import { router, usePathname, useRootNavigationState } from 'expo-router';
import { setupComplete } from '../permissions';
import { useMessenger } from '../runtime';
let presented = false;
export function PermissionSetupGate() {
  const { ready, profile } = useMessenger();
  const pathname = usePathname();
  const navigation = useRootNavigationState();
  useEffect(() => {
    if (!ready || presented || !navigation?.key) return;
    // Let Tabs' initial Redirect settle before pushing a modal over onboarding.
    if ((!profile && pathname !== '/onboarding') || (profile && pathname === '/onboarding')) return;
    let active = true;
    void setupComplete().then(complete => {
      if (active && !complete && !presented) { presented = true; router.push({ pathname: '/permissions', params: { setup: '1', auto: '1' } }); }
    }).catch(() => { /* Settings still provides a manual entry if SecureStore is unavailable. */ });
    return () => { active = false; };
  }, [ready, profile, pathname, navigation?.key]);
  return null;
}
