import {describe,expect,it,vi} from 'vitest';
import {AdaptiveVideoPolicy} from './video.js';
import {PeerSession} from './session.js';
describe('stable video envelope above native congestion/CPU adaptation',()=>{
 it('does not feed a discounted GCC estimate back into encoder shutdown/resizing',()=>{
  const policy=new AdaptiveVideoPolicy();
  const estimates=[2200000,1200000,600000,240000,100000,80000,80000,3000000,3000000,3000000,3000000,3000000,80000,80000,3000000];
  const results=estimates.map((availableOutgoingBitrate,index)=>policy.update({availableOutgoingBitrate,rttMs:40,lossRatio:0},index*2000));
  expect(results.every(result=>result.active&&result.scaleResolutionDownBy===1&&result.maxFramerate===30)).toBe(true);
  expect(new Set(results.map(result=>result.maxBitrate)).size).toBe(1);
 });
 it('keeps native GCC in control for severe or missing feedback and long routes',()=>{
  const policy=new AdaptiveVideoPolicy();
  for(const measurements of [{availableOutgoingBitrate:0,lossRatio:1},{rttMs:800,lossRatio:0.2},{},{availableOutgoingBitrate:NaN,rttMs:Infinity}]){
   expect(policy.update(measurements,20000)).toMatchObject({active:true,maxBitrate:1800000,scaleResolutionDownBy:1});
  }
 });
 it('returns an isolated bounded envelope despite stale clocks or caller mutations',()=>{
  const policy=new AdaptiveVideoPolicy();const first=policy.current();first.active=false;first.maxBitrate=1;
  expect(policy.update({},NaN)).toMatchObject({active:true,maxBitrate:1800000,maxFramerate:30,scaleResolutionDownBy:1});
  expect(policy.update({},-1)).toEqual(policy.current());
 });
});
function fixture(){
 const session=new PeerSession({invite:'ab'.repeat(32),serverUrl:'https://example.test'});const internal=session as any;
 const track={kind:'video',readyState:'live'};let transaction='old';const writes:any[]=[];
 const cached={transactionId:'old',encodings:[{active:true}],codecs:[],headerExtensions:[],rtcp:{}};
 const sender={track,getParameters:vi.fn(()=>({...cached,transactionId:transaction})),setParameters:vi.fn(async(value:any)=>{writes.push(value);})};
 const report=new Map<string,any>([
  ['pair',{id:'pair',type:'candidate-pair',state:'succeeded',nominated:true,currentRoundTripTime:0.03,availableOutgoingBitrate:1000000}],
  ['video',{id:'video',type:'outbound-rtp',kind:'video',packetsSent:100}],
  ['feedback',{id:'feedback',type:'remote-inbound-rtp',kind:'video',localId:'video',fractionLost:0,roundTripTime:0.03}],
  ['incoming',{type:'inbound-rtp',kind:'video',packetsLost:9999}],
 ]);
 const pc={getStats:async()=>report,getSenders:()=>[sender]};internal.pc=pc;internal.callId='call';
 return {session,internal,sender,track,report,pc,writes,cached,newTransaction:()=>{transaction='fresh';}};
}
describe('session video sender integration',()=>{
 it('does not retry identical video targets every stats tick when native normalizes its parameters',async()=>{
  const f=fixture();
  for(let index=0;index<30;index++)await f.internal.readStats();
  expect(f.sender.setParameters).toHaveBeenCalledTimes(1);
  f.internal.callId='next-call';await f.internal.readStats();expect(f.sender.setParameters).toHaveBeenCalledTimes(2);
  f.sender.track={kind:'video',readyState:'live'};await f.internal.readStats();expect(f.sender.setParameters).toHaveBeenCalledTimes(3);
 });
 it('exposes only safe selected codec names and finite received-video diagnostics',async()=>{
  const f=fixture();f.report.set('codec',{mimeType:'video/VP8'});f.report.set('remote-codec',{mimeType:'video/H264'});
  f.report.get('video').codecId='codec';
  Object.assign(f.report.get('incoming'),{codecId:'remote-codec',framesDecoded:300,framesDropped:2,freezeCount:1,totalFreezesDuration:0.4,frameWidth:1280,frameHeight:720});
  await f.internal.readStats();expect(f.session.getSnapshot().stats).toMatchObject({videoCodec:'video/VP8',remoteVideoCodec:'video/H264',videoFramesDecoded:300,videoFramesDropped:2,videoFreezeCount:1,videoFreezeSeconds:0.4,remoteVideoWidth:1280,remoteVideoHeight:720});
  f.report.get('codec').mimeType='https://untrusted.test/private';f.report.get('remote-codec').mimeType='audio/opus';
  Object.assign(f.report.get('incoming'),{framesDecoded:NaN,framesDropped:-1,freezeCount:Infinity});
  await f.internal.readStats();expect(f.session.getSnapshot().stats.videoCodec).toBeUndefined();expect(f.session.getSnapshot().stats.remoteVideoCodec).toBeUndefined();expect(f.session.getSnapshot().stats.videoFramesDecoded).toBeUndefined();expect(f.session.getSnapshot().stats.videoFramesDropped).toBeUndefined();expect(f.session.getSnapshot().stats.videoFreezeCount).toBeUndefined();
 });
 it('reports measured video rate, encoded size/fps and CPU delay without mixing SSRC counters',async()=>{
  const f=fixture();const video=f.report.get('video');
  Object.assign(video,{bytesSent:10000,timestamp:1000,framesEncoded:30,totalEncodeTime:0.15,frameWidth:1280,frameHeight:720,qualityLimitationReason:'cpu'});
  await f.internal.readStats();expect(f.session.getSnapshot().stats).toMatchObject({videoWidth:1280,videoHeight:720,videoQualityLimitation:'cpu'});
  Object.assign(video,{bytesSent:110000,timestamp:3000,framesEncoded:90,totalEncodeTime:0.45});
  await f.internal.readStats();expect(f.session.getSnapshot().stats).toMatchObject({videoBitrateKbps:400,videoFramesPerSecond:30});expect(f.session.getSnapshot().stats.videoEncodeMs).toBeCloseTo(5);
  Object.assign(video,{id:'new-ssrc',bytesSent:10,timestamp:4000,framesEncoded:1,totalEncodeTime:0.1,qualityLimitationReason:'untrusted'});
  await f.internal.readStats();expect(f.session.getSnapshot().stats.videoBitrateKbps).toBeUndefined();expect(f.session.getSnapshot().stats.videoQualityLimitation).toBeUndefined();
  Object.assign(video,{bytesSent:5,timestamp:5000,framesEncoded:0,totalEncodeTime:0});
  await f.internal.readStats();expect(f.session.getSnapshot().stats.videoBitrateKbps).toBeUndefined();expect(f.session.getSnapshot().stats.videoFramesPerSecond).toBeUndefined();expect(f.session.getSnapshot().stats.videoEncodeMs).toBeUndefined();
 });
 it('uses remote video RTCP feedback, not local incoming loss; missing stats keep GCC running',async()=>{
  const f=fixture();await f.internal.readStats();expect(f.writes[0].encodings[0]).toMatchObject({maxBitrate:1800000,maxFramerate:30,scaleResolutionDownBy:1});
  expect(f.cached.encodings).toEqual([{active:true}]);
  f.report.get('feedback').fractionLost=0.2;f.report.get('video').packetsSent=200;await f.internal.readStats();expect(f.writes.at(-1).encodings[0].maxBitrate).toBe(1800000);
  f.report.get('pair').availableOutgoingBitrate=80000;await f.internal.readStats();expect(f.writes.at(-1).encodings[0].active).toBe(true);
  f.pc.getStats=async()=>{throw new Error('unsupported');};await expect(f.internal.readStats()).resolves.toBeUndefined();expect(f.session.getSnapshot().error).toBeUndefined();
 });
 it('uses video RTCP RTT/counter deltas and discards loss baselines after an SSRC change',async()=>{
  const f=fixture();const feedback=f.report.get('feedback');delete feedback.fractionLost;feedback.packetsLost=0;
  await f.internal.readStats();feedback.packetsLost=20;f.report.get('video').packetsSent=200;await f.internal.readStats();expect(f.writes.at(-1).encodings[0].maxBitrate).toBe(1800000);
  f.internal.videoPolicy=new AdaptiveVideoPolicy();feedback.localId='new-video';f.report.get('video').id='new-video';f.report.get('video').packetsSent=5;feedback.packetsLost=0;
  await f.internal.readStats();expect(f.writes.at(-1).encodings[0].maxBitrate).toBe(1800000);
  feedback.roundTripTime=0.8;f.report.get('video').packetsSent=6;await f.internal.readStats();expect(f.writes.at(-1).encodings[0].maxBitrate).toBe(1800000);
 });
 it('does not stop a live encoder or retain stale RTCP pressure when packets do not advance',async()=>{
  const clock=vi.spyOn(performance,'now');
  try{
   const f=fixture();const pair=f.report.get('pair'),feedback=f.report.get('feedback');
   feedback.fractionLost=0.2;feedback.roundTripTime=0.8;pair.availableOutgoingBitrate=80000;
   clock.mockReturnValue(0);await f.internal.readStats();expect(f.writes.at(-1).encodings[0].active).toBe(true);
   pair.availableOutgoingBitrate=2500000;pair.currentRoundTripTime=0.03;
   // No new packets: old remote loss/RTT must not trigger periodic encoder restarts.
   clock.mockReturnValue(2000);await f.internal.readStats();expect(f.writes.at(-1).encodings[0].active).toBe(true);
   clock.mockReturnValue(5999);await f.internal.readStats();expect(f.writes.at(-1).encodings[0].active).toBe(true);
   clock.mockReturnValue(6000);await f.internal.readStats();expect(f.writes.at(-1).encodings[0]).toMatchObject({active:true,maxBitrate:1800000,maxFramerate:30});
   expect(f.report.get('video').packetsSent).toBe(100);expect(feedback.fractionLost).toBe(0.2);expect(feedback.roundTripTime).toBe(0.8);
   // Even genuinely bad feedback stays with native GCC; JS must not toggle encodings.
   f.report.get('video').packetsSent=101;f.internal.videoPolicy=new AdaptiveVideoPolicy();clock.mockReturnValue(14000);await f.internal.readStats();expect(f.writes.at(-1).encodings[0].maxBitrate).toBe(1800000);
  }finally{clock.mockRestore();}
 });
 it('obtains parameters inside the serial queue after a queued negotiation and skips replaced senders',async()=>{
  const f=fixture();let release!:()=>void;f.internal.queue=new Promise<void>(resolve=>{release=resolve;});
  const pending=f.internal.readStats();await Promise.resolve();expect(f.sender.getParameters).not.toHaveBeenCalled();f.newTransaction();release();await pending;
  expect(f.writes[0].transactionId).toBe('fresh');
  let again!:()=>void;f.internal.queue=new Promise<void>(resolve=>{again=resolve;});
  const stale=f.internal.readStats();await Promise.resolve();f.sender.track={kind:'video',readyState:'live'};again();await stale;expect(f.writes).toHaveLength(1);
 });
 it('ignores a completed old-call stats read and a call that ends while tuning is queued',async()=>{
  const f=fixture();let release!:()=>void;f.pc.getStats=()=>new Promise(resolve=>{release=()=>resolve(f.report);});const old=f.internal.readStats();f.internal.callId='next';release();await old;expect(f.writes).toHaveLength(0);
  f.pc.getStats=async()=>f.report;let unblock!:()=>void;f.internal.queue=new Promise<void>(resolve=>{unblock=resolve;});const pending=f.internal.readStats();await Promise.resolve();f.internal.callId=undefined;unblock();await pending;expect(f.writes).toHaveLength(0);
 });
 it('retries unsupported resolution/fps with fresh bitrate-only parameters and survives unavailable setters',async()=>{
  const f=fixture();f.sender.setParameters.mockImplementation(async(value:any)=>{if(value.encodings[0].maxFramerate)throw new Error('unsupported scale');f.writes.push(value);});
  await f.internal.readStats();expect(f.sender.getParameters).toHaveBeenCalledTimes(2);expect(f.writes[0].encodings[0]).toEqual({active:true,maxBitrate:1800000});expect(f.cached.encodings).toEqual([{active:true}]);
  await f.internal.readStats();expect(f.sender.setParameters).toHaveBeenCalledTimes(2);
  f.internal.callId='next-call';f.sender.setParameters.mockRejectedValue(new Error('unavailable'));await f.internal.readStats();const count=f.sender.setParameters.mock.calls.length;await f.internal.readStats();expect(f.sender.setParameters).toHaveBeenCalledTimes(count);expect(f.session.getSnapshot().error).toBeUndefined();
 });
 it('requests bounded720p capture, falls back only for constraints, and never retries a permission denial',async()=>{
  const track={kind:'video',readyState:'live',stop:vi.fn()};const stream={getTracks:()=>[track]};
  const media=vi.fn().mockRejectedValueOnce({name:'OverconstrainedError'}).mockResolvedValue(stream);
  const session=new PeerSession({invite:'ab'.repeat(32),serverUrl:'https://example.test',getUserMedia:media});const internal=session as any;
  const sender={track,getParameters:()=>({encodings:[]})};internal.pc={addTrack:()=>sender,getSenders:()=>[sender]};internal.callId='call';
  await internal.acquireMedia(true);expect(media.mock.calls[0]![0].video).toEqual({width:{ideal:1280,max:1280},height:{ideal:720,max:720},frameRate:{ideal:30,max:30}});expect(media.mock.calls[1]![0].video).toBe(true);
  media.mockClear();media.mockRejectedValue({name:'NotAllowedError'});await expect(internal.acquireMedia(true)).rejects.toMatchObject({name:'NotAllowedError'});expect(media).toHaveBeenCalledTimes(1);
 });
});
