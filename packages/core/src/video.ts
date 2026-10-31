export interface VideoMeasurements {availableOutgoingBitrate?:number;rttMs?:number;lossRatio?:number;}
export interface VideoTarget {active:boolean;maxBitrate:number;maxFramerate:number;scaleResolutionDownBy:number;}
/** Stable safety ceiling above WebRTC's native congestion/CPU adaptation.
 * availableOutgoingBitrate is GCC's own estimate, not independent link capacity.
 * Feeding a discounted estimate back as maxBitrate can ratchet the encoder down;
 * toggling active/scale/fps then restarts it and leaves the decoder without frames.
 * Keep sending enabled and allow native GCC to allocate bandwidth to audio/video,
 * reduce actual rate/resolution and probe recovery without periodic JS overrides.
 */
export class AdaptiveVideoPolicy {
  current():VideoTarget{return {active:true,maxBitrate:1800000,maxFramerate:30,scaleResolutionDownBy:1};}
  update(_measurements:VideoMeasurements,_now:number):VideoTarget{return this.current();}
}
