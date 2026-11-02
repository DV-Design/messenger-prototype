import { useEffect, useState } from 'react';
import { CallCameraController, type CallCameraState, type CallCameraTrack } from './call-camera-model';

/**
 * Binds the call controller to the live local video track. The track identity is
 * stable across a camera switch, so the RTP sender and negotiation stay untouched.
 */
export function useCallCamera(callId: string | undefined, track: CallCameraTrack | undefined) {
  const [state, setState] = useState<CallCameraState>({ available: false, busy: false });
  const [controller] = useState(() => new CallCameraController(setState));

  useEffect(() => {
    controller.setTrack(callId ?? '', track);
  }, [callId, track, controller]);

  useEffect(() => () => controller.dispose(), [controller]);

  return {
    state,
    switchCamera: () => controller.switch() ?? Promise.resolve(),
  };
}
