import { t } from './i18n';
import type { MediaStreamTrack } from 'react-native-webrtc';

export type CallCameraTrack = Pick<MediaStreamTrack, 'remote' | 'kind' | 'readyState' | 'getSettings' | 'getConstraints' | 'applyConstraints'>;
export interface CallCameraState { available: boolean; busy: boolean; facing?: 'user' | 'environment'; error?: string }
const facing = (track?: CallCameraTrack) => {
  const value = track?.getSettings().facingMode;
  return value === 'user' || value === 'environment' ? value : undefined;
};
export class CallCameraController {
  state: CallCameraState = { available: false, busy: false };
  private callId = '';
  private track?: CallCameraTrack;
  private generation = 0;
  constructor(private publish: (state: CallCameraState) => void) {}
  private update(state: CallCameraState) { this.state = state; this.publish(state); }
  setTrack(callId: string, track?: CallCameraTrack) {
    if (this.callId === callId && this.track === track) return;
    this.generation++; this.callId = callId; this.track = track;
    this.update({ available: !!callId && !!track && !track.remote && track.kind === 'video' && track.readyState === 'live', busy: false, facing: facing(track) });
  }
  async switch() {
    const track = this.track;
    if (!this.state.available || this.state.busy || !track || track.remote || track.readyState !== 'live') return;
    const generation = this.generation;
    const desired = facing(track) === 'environment' ? 'user' : 'environment';
    this.update({ ...this.state, busy: true, error: undefined });
    try {
      // Native deviceId takes precedence over facingMode. Retain quality/FPS while
      // removing that old camera binding; reuse the same track and RTP sender.
      const constraints = { ...track.getConstraints(), facingMode: desired };
      delete constraints.deviceId;
      await track.applyConstraints(constraints);
      if (generation !== this.generation || track.readyState !== 'live') return;
      const actual = facing(track);
      if (actual !== desired) throw new Error('Camera did not switch');
      this.update({ available: true, busy: false, facing: actual });
    } catch {
      if (generation === this.generation) this.update({ available: track.readyState === 'live', busy: false, facing: facing(track), error: t('Could not switch the camera. Try again.') });
    }
  }
  dispose() { this.generation++; this.track = undefined; this.callId = ''; }
}
