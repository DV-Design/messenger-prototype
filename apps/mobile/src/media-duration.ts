import { useEffect, useState } from 'react';
import type { MessengerFile } from '@messenger/core';
import { loadFileData } from './attachments';
import { mp4Duration } from './media-duration-model';

const known = new Map<string, number | null>();
/** The recording's length once read (null when it cannot be read); read lazily and kept in memory. */
export function useMediaDuration(file: MessengerFile, enabled: boolean): number | null | undefined {
  const key = `${file.conversationId}:${file.senderId}:${file.id}`;
  const [, setVersion] = useState(0);
  const value = known.get(key);
  useEffect(() => {
    if (!enabled || known.has(key)) return;
    let canceled = false;
    void loadFileData(file).then(bytes => { known.set(key, bytes ? mp4Duration(bytes) ?? null : null); }).catch(() => { known.set(key, null); })
      .finally(() => { if (!canceled) setVersion(version => version + 1); });
    return () => { canceled = true; };
    // The file object changes with every delivery tick; its key identifies the recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  return value;
}
