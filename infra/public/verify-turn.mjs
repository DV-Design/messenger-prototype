/** Dispatch-only external relay smoke. Input is short-lived TURN credentials, never
 * the TURN shared secret. No browser trace, screenshot, SDP or credential logging. */
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {resolve4} from 'node:dns/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const origin='https://lienad.ru';
const pageUrl=origin+'/messenger/relay-ci';
const transports=[
  {protocol:'TURN/UDP',url:'turn:p2p.lienad.ru:3478?transport=udp'},
  {protocol:'TURN/TCP',url:'turn:p2p.lienad.ru:3478?transport=tcp'},
  {protocol:'TURN/TLS',url:'turns:p2p.lienad.ru:5349?transport=tcp'},
];
const deadline=Date.now()+6*60*1000;
function credentials(value){
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!['username','credential'].includes(k))||typeof value.username!=='string'||!/^\d{10}:[A-Za-z0-9_-]{1,64}$/.test(value.username)||typeof value.credential!=='string'||! /^[A-Za-z0-9+/]{20,128}={0,2}$/.test(value.credential))throw new Error('invalid-input');
  const expires=Number(value.username.split(':')[0])*1000;
  if(expires<=Date.now()+30_000||expires>Date.now()+15*60_000)throw new Error('credential-deadline-invalid');
  return {username:value.username,credential:value.credential};
}
function requireInput(){
  const raw=process.env.LASTCALL_TURN_QA_ICE;
  if(!raw||raw.length>8192)throw new Error('missing-or-invalid-input');
  let value;try{value=JSON.parse(raw);}catch{throw new Error('invalid-input');}
  // Preferred: six distinct short-lived client credentials, one per peer/transport.
  // {version:1,transports:[{url:<approvedURL>,peers:[{username,credential},...]}...]}
  if(value?.version===1){
    if(Object.keys(value).some(k=>!['version','transports'].includes(k))||!Array.isArray(value.transports)||value.transports.length!==3)throw new Error('invalid-input');
    const usernames=new Set();const urls=new Set();const result=[];
    for(const entry of value.transports){
      if(!entry||Object.keys(entry).some(k=>!['url','peers'].includes(k))||!transports.some(t=>t.url===entry.url)||urls.has(entry.url)||!Array.isArray(entry.peers)||entry.peers.length!==2)throw new Error('invalid-input');
      urls.add(entry.url);const peers=entry.peers.map(peer=>{const valid=credentials(peer);if(usernames.has(valid.username))throw new Error('reused-input');usernames.add(valid.username);return {...valid,urls:[entry.url]};});result.push({url:entry.url,peers});
    }
    return result;
  }
  // Legacy shared-credential format remains available to diagnose quota artifacts.
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!['urls','username','credential','credentialType'].includes(k))||!Array.isArray(value.urls)||value.urls.length!==3||new Set(value.urls).size!==3||transports.some(t=>!value.urls.includes(t.url))||value.credentialType!==undefined&&value.credentialType!=='password')throw new Error('invalid-input');
  const valid=credentials({username:value.username,credential:value.credential});
  return transports.map(t=>({url:t.url,peers:[{...valid,urls:[t.url]},{...valid,urls:[t.url]}]}));
}
async function bounded(promise,timeout=20_000){
  let timer;const remaining=Math.min(timeout,deadline-Date.now());
  if(remaining<=0)throw new Error('deadline');
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('deadline')),remaining);})]);}finally{clearTimeout(timer);}
}
async function poll(operation,accept,timeout=25_000){
  const end=Math.min(deadline,Date.now()+timeout);
  while(Date.now()<end){const value=await bounded(operation(),Math.min(5000,end-Date.now()));if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,200));}
  throw new Error('deadline');
}
async function egress(){
  for(const url of ['https://api.ipify.org','https://checkip.amazonaws.com']){
    try{const response=await fetch(url,{signal:AbortSignal.timeout(5000)});const value=(await response.text()).trim();if(response.ok&&isIP(value))return value;}catch{/* Try the second IP-only endpoint. */}
  }
  throw new Error('egress-unavailable');
}
async function requireExternal(publicIp){
  const addresses=await resolve4('p2p.lienad.ru');
  if(isIP(publicIp)!==4||!addresses.length||addresses.some(address=>isIP(address)!==4)||addresses.includes(publicIp))throw new Error('not-external');
}
async function factory(){
  const result=await build({absWorkingDir:root,stdin:{contents:`
import {PeerSession,createInvite,iceServersSchema} from './packages/core/src/index.ts';
window.lastcallTurnQa={
 create(invite,ice){
  const validated=iceServersSchema.parse([ice]);this.iceErrorCodes=[];this.gatheredRelay=0;
  this.session=new PeerSession({serverUrl:'https://lienad.ru/messenger',invite,relayOnly:true,iceServers:validated,rtcFactory:config=>{
   const pc=new RTCPeerConnection(config);this.pc=pc;
   pc.addEventListener('icecandidateerror',event=>{if(Number.isInteger(event.errorCode)&&event.errorCode>=0&&event.errorCode<=999&&this.iceErrorCodes.length<16)this.iceErrorCodes.push(event.errorCode);});
   pc.addEventListener('icecandidate',event=>{if(event.candidate?.type==='relay')this.gatheredRelay++;});return pc;
  }});
 },
 invite(){return createInvite();},
 async diagnostics(){
  const state=this.session?.getSnapshot();const pc=this.pc;let localRelay=0,remoteRelay=0,relayPairs=0,succeededRelayPairs=0;
  try{const reports=await pc?.getStats();const local=new Set(),remote=new Set();reports?.forEach(r=>{if(r.candidateType==='relay'){if(r.type==='local-candidate'){local.add(r.id);localRelay++;}else if(r.type==='remote-candidate'){remote.add(r.id);remoteRelay++;}}});reports?.forEach(r=>{if(r.type==='candidate-pair'&&(local.has(r.localCandidateId)||remote.has(r.remoteCandidateId))){relayPairs++;if(r.state==='succeeded')succeededRelayPairs++;}});}catch{}
  return {status:state?.status??'uncreated',route:state?.route??'unknown',pcState:pc?.connectionState??'uncreated',iceState:pc?.iceConnectionState??'uncreated',gatheringState:pc?.iceGatheringState??'uncreated',signalingState:pc?.signalingState??'uncreated',dataState:this.session?.channel?.readyState??'uncreated',gatheredRelay:this.gatheredRelay??0,localRelay,remoteRelay,relayPairs,succeededRelayPairs,iceErrorCodes:[...new Set(this.iceErrorCodes??[])]};
 },
 async inbound(){const reports=await this.session.pc?.getStats();let bytes=0;reports?.forEach(r=>{if(r.type==='inbound-rtp'&&!r.isRemote&&(r.kind==='audio'||r.mediaType==='audio'))bytes+=r.bytesReceived??0;});return bytes;},
};`,resolveDir:root,sourcefile:'lastcall-turn-qa.ts'},bundle:true,platform:'browser',format:'iife',target:'chrome120',write:false,logLevel:'silent'});
  return result.outputFiles[0].text;
}
async function runTransport(browser,bundle,peers,transport,publicIp){
  const contexts=[];let stage='contexts';
  const result={protocol:transport.protocol,egress:publicIp,status:'FAIL',stage};
  try{
    for(let i=0;i<2;i++)contexts.push(await browser.newContext({permissions:['microphone','camera']}));
    const pages=await Promise.all(contexts.map(async context=>{
      await context.route(pageUrl,route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>LastCall TURN QA</title>'}));
      const page=await context.newPage();await page.goto(pageUrl,{waitUntil:'domcontentloaded',timeout:15000});await page.addScriptTag({content:bundle});return page;
    }));
    const [a,b]=pages;const invite=await a.evaluate(()=>window.lastcallTurnQa.invite());
    stage='connect';
    for(const [i,page]of pages.entries())await page.evaluate(({invite,ice})=>window.lastcallTurnQa.create(invite,ice),{invite,ice:peers[i]});
    await bounded(a.evaluate(()=>window.lastcallTurnQa.session.connect()));
    await bounded(b.evaluate(()=>window.lastcallTurnQa.session.connect()));
    await poll(()=>Promise.all(pages.map(page=>page.evaluate(()=>{const s=window.lastcallTurnQa.session.getSnapshot();return {status:s.status,route:s.route};}))),states=>states.every(s=>s.status==='connected'&&s.route==='relay'),35_000);
    stage='text-ack';
    for(const [sender,receiver,text] of [[a,b,'relay-a-to-b'],[b,a,'relay-b-to-a']]){
      await bounded(sender.evaluate(text=>window.lastcallTurnQa.session.sendText(text),text));
      await poll(()=>Promise.all([sender.evaluate(text=>window.lastcallTurnQa.session.getSnapshot().messages.some(m=>m.text===text&&m.from==='self'&&m.status==='delivered'),text),receiver.evaluate(text=>window.lastcallTurnQa.session.getSnapshot().messages.some(m=>m.text===text&&m.from==='peer'),text)]),values=>values.every(Boolean));
    }
    stage='file-hash-ack';
    const bytes=Array.from({length:30_000},(_,i)=>i%251);const expected=createHash('sha256').update(Buffer.from(bytes)).digest('hex');
    const sending=b.evaluate(bytes=>window.lastcallTurnQa.session.sendFile({name:'relay-qa.bin',mime:'application/octet-stream',data:new Uint8Array(bytes)}),bytes);
    await bounded(sending,30_000);
    const observed=await poll(()=>a.evaluate(async()=>{const f=window.lastcallTurnQa.session.getSnapshot().files.find(f=>f.name==='relay-qa.bin'&&f.status==='complete');if(!f?.data)return null;const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(f.data));return {bytes:f.data.length,hash:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};}),Boolean);
    if(observed.hash!==expected||observed.bytes!==bytes.length)throw new Error('file-mismatch');
    stage='call';await bounded(a.evaluate(()=>window.lastcallTurnQa.session.startCall(false)));
    await poll(()=>b.evaluate(()=>window.lastcallTurnQa.session.getSnapshot().callState),state=>state==='incoming');
    await bounded(b.evaluate(()=>window.lastcallTurnQa.session.acceptCall()));
    await poll(()=>Promise.all(pages.map(page=>page.evaluate(()=>{const s=window.lastcallTurnQa.session.getSnapshot();window.lastcallTurnQa.tracks=s.localStream?.getTracks()??[];return s.callState==='active'&&(s.remoteStream?.getAudioTracks().some(t=>t.readyState==='live')??false);}))),states=>states.every(Boolean));
    stage='inbound-audio';const baseline=await Promise.all(pages.map(page=>page.evaluate(()=>window.lastcallTurnQa.inbound())));
    const audio=await poll(()=>Promise.all(pages.map(page=>page.evaluate(()=>window.lastcallTurnQa.inbound()))),values=>values.every((bytes,i)=>bytes>baseline[i]),20_000);
    stage='hangup';await a.evaluate(()=>window.lastcallTurnQa.session.endCall());
    await poll(()=>Promise.all(pages.map(page=>page.evaluate(()=>{const q=window.lastcallTurnQa;return q.session.getSnapshot().callState==='idle'&&q.tracks.length>0&&q.tracks.every(t=>t.readyState==='ended');}))),states=>states.every(Boolean));
    Object.assign(result,{status:'PASS',stage:'complete',routes:['relay','relay'],textAcks:2,fileBytes:observed.bytes,fileSha256Match:true,inboundAudioBytes:audio.map((bytes,i)=>bytes-baseline[i]),tracksStopped:true});
  }catch{result.stage=stage;result.diagnostics=[];for(const context of contexts)for(const page of context.pages()){try{result.diagnostics.push(await bounded(page.evaluate(()=>window.lastcallTurnQa.diagnostics()),3000));}catch{result.diagnostics.push({status:'unavailable'});}}}finally{
    for(const context of contexts){for(const page of context.pages())await page.evaluate(()=>window.lastcallTurnQa?.session?.disconnect()).catch(()=>{});await context.close().catch(()=>{});}
  }
  return result;
}
let browser;
try{
  const inputs=requireInput();delete process.env.LASTCALL_TURN_QA_ICE;
  const publicIp=await egress();if(process.env.TURN_QA_REQUIRE_EXTERNAL==='1')await requireExternal(publicIp);const bundle=await factory();
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const results=[];
  for(const transport of transports){const result=await runTransport(browser,bundle,inputs.find(input=>input.url===transport.url).peers,transport,publicIp);results.push(result);console.log(JSON.stringify(result));}
  console.log(JSON.stringify({status:results.every(r=>r.status==='PASS')?'PASS':'FAIL',passed:results.filter(r=>r.status==='PASS').length,total:transports.length}));
  if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
}catch{
  // Never print a provider/browser exception: it may embed ICE configuration or SDP.
  console.log(JSON.stringify({status:'FAIL',stage:'setup',reason:'missing-invalid-expired-input-or-unavailable-runtime'}));process.exitCode=1;
}finally{await browser?.close().catch(()=>{});}
