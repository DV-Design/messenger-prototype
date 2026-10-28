import { useCallback, useEffect, useState } from 'react';
import type { ServiceCapabilities } from '@messenger/core';
import { client, errorText, useMessenger } from './runtime';
export function useServices() {
  const { snapshot, profile } = useMessenger();
  const [result, setResult] = useState<{ capabilities?: ServiceCapabilities; error?: string; server?: string }>({});
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (snapshot.status !== 'online') return;
    let active = true;
    void client().getServices().then(capabilities => { if (active) setResult({ capabilities, server: profile?.serverUrl }); })
      .catch(cause => { if (active) setResult({ error: errorText(cause), server: profile?.serverUrl }); });
    return () => { active = false; };
  }, [snapshot.status, profile?.serverUrl, revision]);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const valid = result.server === profile?.serverUrl && snapshot.status === 'online';
  return { capabilities: valid ? result.capabilities : undefined, error: valid ? result.error : undefined, refresh };
}
