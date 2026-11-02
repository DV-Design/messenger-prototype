import {describe,expect,it} from 'vitest';
import {createDeviceIdentity} from './directory.js';
import {ContentCipher,SAFETY_EMOJI,callSafetyEmoji,createContentHello,safetyEmoji,verifyContentHello} from './content-crypto.js';

const alice=createDeviceIdentity(n=>new Uint8Array(n).fill(11));const bob=createDeviceIdentity(n=>new Uint8Array(n).fill(12));
function counter(seed=0){let value=seed;return (length:number)=>{value++;const result=new Uint8Array(length);result[0]=value&0xff;result[1]=(value>>8)&0xff;return result;};}
function pair(){
  const first=createContentHello(alice,bob.userId,counter(1));const second=createContentHello(bob,alice.userId,counter(2));
  const a=ContentCipher.derive({localHello:first.hello,remoteHello:second.hello,ephemeralPrivateKey:first.privateKey,localUserId:alice.userId,remoteUserId:bob.userId,random:counter(3)});
  const b=ContentCipher.derive({localHello:second.hello,remoteHello:first.hello,ephemeralPrivateKey:second.privateKey,localUserId:bob.userId,remoteUserId:alice.userId,random:counter(4)});
  return {a,b,first,second};
}
describe('signed content handshake',()=>{
  it('verifies only the addressed peer with the pinned identity key',()=>{
    const {first,second}=pair();
    expect(verifyContentHello(first.hello,alice.publicKey,alice.userId,bob.userId)).toBe(true);
    expect(verifyContentHello(second.hello,bob.publicKey,bob.userId,alice.userId)).toBe(true);
    expect(verifyContentHello(first.hello,bob.publicKey,bob.userId,alice.userId)).toBe(false);
    expect(verifyContentHello(first.hello,alice.publicKey,alice.userId,alice.userId)).toBe(false);
    expect(verifyContentHello({...first.hello,signature:'00'.repeat(64)},alice.publicKey,alice.userId,bob.userId)).toBe(false);
    expect(verifyContentHello({...first.hello,publicKey:'00'.repeat(32)},alice.publicKey,alice.userId,bob.userId)).toBe(false);
  });
  it('derives different per-ephemeral-session keys and ignores hello objects from another session',()=>{
    const {a,b,first}=pair();
    const next=createContentHello(alice,bob.userId,counter(9));
    const other=ContentCipher.derive({localHello:first.hello,remoteHello:createContentHello(bob,alice.userId,counter(10)).hello,ephemeralPrivateKey:first.privateKey,localUserId:alice.userId,remoteUserId:bob.userId,random:counter(11)});
    const sealed=a.seal({kind:'text',text:'secret'});
    expect(()=>b.open(sealed)).not.toThrow();
    expect(()=>other.open(sealed)).toThrow();
    expect(()=>b.open({...sealed,sequence:sealed.sequence+1})).toThrow();
    expect(next.hello.signature).not.toBe(first.hello.signature);
  });
});
describe('sealed content',()=>{
  it('round-trips text, application and file frames with unique nonces',()=>{
    const {a,b}=pair();
    const frames=[{kind:'text',text:'привет'},{kind:'application',body:'{"x":1}'},{kind:'file-chunk',id:'ab'.repeat(16),offset:0,hex:'00ff'}];
    const sealed=frames.map(frame=>a.seal(frame));
    expect(sealed.map(value=>value.nonce)).toHaveLength(3);
    expect(new Set(sealed.map(value=>value.nonce)).size).toBe(3);
    for (let index = 0; index < sealed.length; index++) expect(b.open(sealed[index])).toEqual(frames[index]);
  });
  it('rejects replay, reordering, tampering and cross-session ciphertext',()=>{
    const {a,b,first}=pair();
    const sealed=a.seal({kind:'text',text:'once'});
    expect(b.open(sealed)).toEqual({kind:'text',text:'once'});
    expect(()=>b.open(sealed)).toThrow(/replayed|reordered/i);
    const damaged={...sealed,ciphertext:sealed.ciphertext.slice(0,-2)+(sealed.ciphertext.endsWith('00')?'01':'00')};
    expect(()=>b.open(damaged)).toThrow();
    const fresh=ContentCipher.derive({localHello:first.hello,remoteHello:createContentHello(bob,alice.userId,counter(21)).hello,ephemeralPrivateKey:first.privateKey,localUserId:alice.userId,remoteUserId:bob.userId,random:counter(22)});
    expect(()=>fresh.open(sealed)).toThrow();
  });
  it('binds ciphertext to sender, recipient and sequence through AAD',()=>{
    const {a,b}=pair();
    const sealed=a.seal({kind:'text',text:'bound'});
    const moved={...sealed,sequence:sealed.sequence+1};
    expect(()=>b.open(moved)).toThrow();
    b.dispose();
    expect(()=>b.open(sealed)).toThrow(/closed/i);
    expect(()=>a.seal({kind:'text',text:'after close'})).not.toThrow();
    a.dispose();
    expect(()=>a.seal({kind:'text',text:'closed'})).toThrow(/closed/i);
  });
});
describe('emoji verification codes',()=>{
  it('produces a stable order-independent five-emoji safety code and call code',()=>{
    const code=safetyEmoji(alice.publicKey,bob.publicKey);
    expect(code).toBe(safetyEmoji(bob.publicKey,alice.publicKey));
    expect(code.split(' ')).toHaveLength(5);
    for (const emoji of code.split(' ')) expect(SAFETY_EMOJI).toContain(emoji);
    const callId='ab'.repeat(16);
    expect(callSafetyEmoji(alice.publicKey,bob.publicKey,callId)).toBe(callSafetyEmoji(bob.publicKey,alice.publicKey,callId));
    expect(callSafetyEmoji(alice.publicKey,bob.publicKey,callId).split(' ')).toHaveLength(5);
    expect(callSafetyEmoji(alice.publicKey,bob.publicKey,'cd'.repeat(16))).not.toBe(callSafetyEmoji(alice.publicKey,bob.publicKey,callId));
  });
});
