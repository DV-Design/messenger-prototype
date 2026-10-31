import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

const serverUrl=`http://127.0.0.1:${process.env.PW_SERVER_PORT||'8799'}`;
const probeUrl=`http://127.0.0.1:${process.env.PW_PROBE_PORT||'5174'}`;

// Actual local RTP/codec/decoder. Only the optional GCC estimate reported to the
// application is controlled: it must never switch a live camera encoder off.
test('video stays live beyond one minute through fluctuating and missing GCC estimates',async({browser},testInfo)=>{
 test.setTimeout(95000);
 const contexts=await Promise.all([0,1].map(()=>browser.newContext({permissions:['microphone','camera']})));
 const pages=await Promise.all(contexts.map(context=>context.newPage()));const [a,b]=pages;
 try{
  await Promise.all(pages.map(page=>page.goto(probeUrl)));
  await a!.getByTestId('generate').click();const invite=await a!.getByTestId('invite').inputValue();
  for(const page of pages){await page.getByTestId('server-url').fill(serverUrl);await page.getByTestId('invite').fill(invite);}
  await a!.getByTestId('connect').click();await expect(a!.getByTestId('status')).toHaveAttribute('data-state','waiting');
  await b!.getByTestId('connect').click();for(const page of pages)await expect(page.getByTestId('status')).toHaveAttribute('data-state','connected');
  await a!.getByTestId('video-call').click();await expect(b!.getByTestId('call-state')).toHaveAttribute('data-state','incoming');await b!.getByTestId('accept-call').click();
  for(const page of pages)await expect(page.getByTestId('call-state')).toHaveAttribute('data-state','active');
  for(const page of pages)await page.evaluate(()=>{
   const w=window as any,pc=w.__session.pc as RTCPeerConnection,originalStats=pc.getStats.bind(pc),start=performance.now();
   w.__videoTrace={changes:[],samples:[],start};w.__videoRawStats=originalStats;
   const estimates=[2200000,1200000,600000,240000,100000,80000,80000,3000000,3000000,3000000,3000000,3000000,80000,80000,3000000,3000000];
   pc.getStats=(async()=>{
    const report=await originalStats(),copy=new Map<string,any>();const step=Math.floor((performance.now()-start)/2000);
    report.forEach((row:any,key:string)=>{const value={...row};if(value.type==='candidate-pair'){if(step>=estimates.length)delete value.availableOutgoingBitrate;else value.availableOutgoingBitrate=estimates[step];}copy.set(key,value);});return copy;
   }) as typeof pc.getStats;
   for(const sender of pc.getSenders().filter(sender=>sender.track?.kind==='video')){
    const original=sender.setParameters.bind(sender);
    sender.setParameters=async(parameters)=>{w.__videoTrace.changes.push({ms:performance.now()-start,encodings:parameters.encodings.map(({active,maxBitrate,maxFramerate,scaleResolutionDownBy})=>({active,maxBitrate,maxFramerate,scaleResolutionDownBy}))});return original(parameters);};
   }
  });
  const started=Date.now();
  while(Date.now()-started<66000){
   await a!.waitForTimeout(2000);
   for(const page of pages)await page.evaluate(async()=>{
    const w=window as any,report=await w.__videoRawStats();let incoming:any,outgoing:any;
    report.forEach((row:any)=>{if(row.type==='inbound-rtp'&&row.kind==='video')incoming=row;if(row.type==='outbound-rtp'&&row.kind==='video')outgoing=row;});
    const video=document.querySelector('[data-testid="remote-video"]') as HTMLVideoElement;
    const codec=incoming?.codecId?report.get(incoming.codecId):undefined;
    w.__videoTrace.samples.push({ms:performance.now()-w.__videoTrace.start,decoded:incoming?.framesDecoded??0,received:incoming?.framesReceived??0,dropped:incoming?.framesDropped??0,keyFrames:incoming?.keyFramesDecoded??0,freezes:incoming?.freezeCount??0,freezeSeconds:incoming?.totalFreezesDuration??0,codec:codec?.mimeType,width:video.videoWidth,height:video.videoHeight,rendered:video.getVideoPlaybackQuality().totalVideoFrames,encoderFps:outgoing?.framesPerSecond,encoderWidth:outgoing?.frameWidth,encoderHeight:outgoing?.frameHeight});
   });
  }
  const traces=[];
  for(const [index,page] of pages.entries()){
   const trace=await page.evaluate(()=>(window as any).__videoTrace);
   traces.push(trace);
   const path=testInfo.outputPath(`video-stability-peer-${index}.json`);await writeFile(path,JSON.stringify(trace,null,2));
   await testInfo.attach(`video-stability-peer-${index}.json`,{path,contentType:'application/json'});
  }
  for(const trace of traces){
   expect(trace.samples.at(-1).decoded).toBeGreaterThan(100);
   expect(trace.samples.every((sample:any)=>sample.width>0&&sample.height>0)).toBe(true);
   expect(trace.changes.flatMap((change:any)=>change.encodings).some((encoding:any)=>encoding.active===false),'application must not stop/restart live RTP from a GCC estimate').toBe(false);
   let lastAdvance=0,lastFrames=0,maxGap=0;
   for(const sample of trace.samples){if(sample.decoded>lastFrames){maxGap=Math.max(maxGap,sample.ms-lastAdvance);lastAdvance=sample.ms;lastFrames=sample.decoded;}}
   maxGap=Math.max(maxGap,trace.samples.at(-1).ms-lastAdvance);
   expect(maxGap,'decoded frames must keep advancing after the20s mark').toBeLessThan(6500);
   expect(trace.samples.at(-1).codec).toMatch(/^video\//);
  }
 }finally{await Promise.all(contexts.map(context=>context.close()));}
});
