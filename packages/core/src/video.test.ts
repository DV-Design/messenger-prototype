import {describe,expect,it,vi} from 'vitest';
import {AdaptiveVideoPolicy} from './video.js';
import {PeerSession} from './session.js';
describe('voice-first video envelope above native congestion control',()=>{
 it('starts with a full720p ceiling, then reserves voice before pausing on a real low budget',()=>{
  const policy=new AdaptiveVideoPolicy();expect(policy.current()).toMatchObject({maxBitrate:1800000,maxFramerate:30,scaleResolutionDownBy:1});
  expect(policy.update({availableOutgoingBitrate:250000,rttMs:40,lossRatio:0},0)).toMatchObject({active:true,maxBitrate:120000,maxFramerate:10,scaleResolutionDownBy:4});
  expect(policy.update({availableOutgoingBitrate:110000},2000)).toMatchObject({active:true,maxBitrate:24000,maxFramerate:5});
  expect(policy.update({availableOutgoingBitrate:90000},4000).active).toBe(false);
  expect(policy.update({availableOutgoingBitrate:1000000,lossRatio:0.2},6000)).toMatchObject({active:false});
 });
 it('does not mistake long baseline RTT or missing bandwidth estimates for congestion',()=>{
  const policy=new AdaptiveVideoPolicy();
  expect(policy.update({rttMs:800,lossRatio:0},0).maxBitrate).toBe(1800000);
  expect(policy.update({},4000).scaleResolutionDownBy).toBe(1);
  expect(policy.update({availableOutgoingBitrate:NaN,rttMs:Infinity},8000).maxBitrate).toBe(1800000);
 });
 it('lets GCC handle brief moderate loss, but reduces on sustained or severe receiver loss',()=>{
  const policy=new AdaptiveVideoPolicy();
  expect(policy.update({lossRatio:0.06},0).maxBitrate).toBe(1800000);
  expect(policy.update({lossRatio:0},2000).maxBitrate).toBe(1800000);
  policy.update({lossRatio:0.06},4000);
  expect(policy.update({lossRatio:0.06},6000).maxBitrate).toBe(120000);
  expect(policy.update({lossRatio:0.2},8000).maxBitrate).toBe(40000);
 });
 it('recovers one tier after sustained headroom and restarts recovery after pressure or clock rollback',()=>{
  const policy=new AdaptiveVideoPolicy();policy.update({lossRatio:0.2},0);
  const good={availableOutgoingBitrate:3000000,rttMs:600,lossRatio:0};
  policy.update(good,2000);expect(policy.update(good,5999).maxBitrate).toBe(40000);
  expect(policy.update(good,6000).maxBitrate).toBe(120000);
  policy.update(good,8000);expect(policy.update(good,12000).maxBitrate).toBe(450000);
  policy.update(good,14000);expect(policy.update(good,18000).maxBitrate).toBe(900000);
  policy.update(good,20000);expect(policy.update(good,24000).maxBitrate).toBe(1800000);
  policy.update({lossRatio:0.2},26000);policy.update(good,28000);
  expect(policy.update(good,100).maxBitrate).toBe(40000);
  expect(policy.update(good,4099).maxBitrate).toBe(40000);
  expect(policy.update(good,4100).maxBitrate).toBe(120000);
 });
 it('recovers all the way with healthy receiver reports even when native omits bandwidth',()=>{
  const policy=new AdaptiveVideoPolicy();policy.update({lossRatio:0.2},0);
  const good={rttMs:500,lossRatio:0};
  for(let level=0;level<4;level++){policy.update(good,2000+level*6000);policy.update(good,6000+level*6000);}
  expect(policy.current()).toMatchObject({maxBitrate:1800000,scaleResolutionDownBy:1});
 });
 it('slowly probes after missing feedback instead of retaining an old tiny cap indefinitely',()=>{
  const policy=new AdaptiveVideoPolicy();policy.update({lossRatio:0.2},0);
  policy.update({},2000);expect(policy.update({},9999).maxBitrate).toBe(40000);
  expect(policy.update({},10000).maxBitrate).toBe(120000);
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
  const f=fixture();await f.internal.readStats();expect(f.writes[0].encodings[0]).toMatchObject({maxBitrate:450000,maxFramerate:20,scaleResolutionDownBy:2});
  expect(f.cached.encodings).toEqual([{active:true}]);
  f.report.get('feedback').fractionLost=0.2;f.report.get('video').packetsSent=200;await f.internal.readStats();expect(f.writes.at(-1).encodings[0].maxBitrate).toBe(40000);
  f.report.get('pair').availableOutgoingBitrate=80000;await f.internal.readStats();expect(f.writes.at(-1).encodings[0].active).toBe(false);
  f.pc.getStats=async()=>{throw new Error('unsupported');};await expect(f.internal.readStats()).resolves.toBeUndefined();expect(f.session.getSnapshot().error).toBeUndefined();
 });
 it('uses video RTCP RTT/counter deltas and discards loss baselines after an SSRC change',async()=>{
  const f=fixture();const feedback=f.report.get('feedback');delete feedback.fractionLost;feedback.packetsLost=0;
  await f.internal.readStats();feedback.packetsLost=20;f.report.get('video').packetsSent=200;await f.internal.readStats();expect(f.writes.at(-1).encodings[0].maxBitrate).toBe(40000);
  f.internal.videoPolicy=new AdaptiveVideoPolicy();feedback.localId='new-video';f.report.get('video').id='new-video';f.report.get('video').packetsSent=5;feedback.packetsLost=0;
  await f.internal.readStats();expect(f.writes.at(-1).encodings[0].maxBitrate).toBe(450000);
  feedback.roundTripTime=0.8;f.report.get('video').packetsSent=6;await f.internal.readStats();expect(f.writes.at(-1).encodings[0].maxBitrate).toBe(450000);
 });
 it('resumes paused video after healthy pair estimates despite frozen bad video RTCP',async()=>{
  const clock=vi.spyOn(performance,'now');
  try{
   const f=fixture();const pair=f.report.get('pair'),feedback=f.report.get('feedback');
   feedback.fractionLost=0.2;feedback.roundTripTime=0.8;pair.availableOutgoingBitrate=80000;
   clock.mockReturnValue(0);await f.internal.readStats();expect(f.writes.at(-1).encodings[0].active).toBe(false);
   pair.availableOutgoingBitrate=2500000;pair.currentRoundTripTime=0.03;
   // Encoder is paused: packetsSent and its old remote loss/RTT report never change.
   clock.mockReturnValue(2000);await f.internal.readStats();expect(f.writes.at(-1).encodings[0].active).toBe(false);
   clock.mockReturnValue(5999);await f.internal.readStats();expect(f.writes.at(-1).encodings[0].active).toBe(false);
   clock.mockReturnValue(6000);await f.internal.readStats();expect(f.writes.at(-1).encodings[0]).toMatchObject({active:true,maxBitrate:40000,maxFramerate:5});
   expect(f.report.get('video').packetsSent).toBe(100);expect(feedback.fractionLost).toBe(0.2);expect(feedback.roundTripTime).toBe(0.8);
   // Once sending advances again, a genuinely bad receiver report still causes immediate reduction.
   f.report.get('video').packetsSent=101;f.internal.videoPolicy=new AdaptiveVideoPolicy();clock.mockReturnValue(14000);await f.internal.readStats();expect(f.writes.at(-1).encodings[0].maxBitrate).toBe(40000);
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
  await f.internal.readStats();expect(f.sender.getParameters).toHaveBeenCalledTimes(2);expect(f.writes[0].encodings[0]).toEqual({active:true,maxBitrate:450000});expect(f.cached.encodings).toEqual([{active:true}]);
  await f.internal.readStats();expect(f.sender.setParameters).toHaveBeenCalledTimes(3);
  f.sender.setParameters.mockRejectedValue(new Error('unavailable'));await f.internal.readStats();const count=f.sender.setParameters.mock.calls.length;await f.internal.readStats();expect(f.sender.setParameters).toHaveBeenCalledTimes(count);expect(f.session.getSnapshot().error).toBeUndefined();
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
