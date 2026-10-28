import { describe, expect, it } from 'vitest';
import { createDeviceIdentity } from './directory.js';
import { MAX_ATTACHMENT_BYTES, MAX_LOCAL_STATE_BYTES, MAX_SEALED_ATTACHMENT_BYTES, openAttachment, openLocalState, sealAttachment, sealLocalState } from './persistence.js';

const alice=createDeviceIdentity(()=>new Uint8Array(32).fill(1));
const bob=createDeviceIdentity(()=>new Uint8Array(32).fill(2));
const key='ab'.repeat(32);
describe('sealed attachment blobs',()=>{
  it('persists binary bytes separately without changing the metadata bound or caller bytes',()=>{
    const bytes=new Uint8Array([0,1,2,255,128]);
    const sealed=sealAttachment(alice,key,bytes);
    expect(openAttachment(alice,key,sealed)).toEqual(bytes);
    expect(bytes).toEqual(new Uint8Array([0,1,2,255,128]));
    expect(JSON.parse(sealed).ciphertext).toBeTypeOf('string');
    expect(MAX_LOCAL_STATE_BYTES).toBe(8*1024*1024);
    expect(()=>openLocalState(alice,sealed)).toThrow();
    expect(()=>openAttachment(alice,key,sealLocalState(alice,{text:'private'}))).toThrow();
  });
  it('authenticates identity, attachment key, nonce and ciphertext',()=>{
    const sealed=sealAttachment(alice,key,new Uint8Array([42,43]));
    expect(()=>openAttachment(bob,key,sealed)).toThrow();
    expect(()=>openAttachment(alice,'cd'.repeat(32),sealed)).toThrow();
    for(const property of ['nonce','ciphertext']){
      const changed=JSON.parse(sealed);changed[property]=(changed[property].startsWith('ff')?'00':'ff')+changed[property].slice(2);
      expect(()=>openAttachment(alice,key,JSON.stringify(changed))).toThrow();
    }
    expect(sealAttachment(alice,key,new Uint8Array([42,43]))).not.toBe(sealed);
  });
  it('accepts the exact byte boundary and rejects oversized or malformed envelopes and paths',()=>{
    const bytes=new Uint8Array(MAX_ATTACHMENT_BYTES).fill(17);
    expect(openAttachment(alice,key,sealAttachment(alice,key,bytes))).toEqual(bytes);
    expect(()=>sealAttachment(alice,key,new Uint8Array(MAX_ATTACHMENT_BYTES+1))).toThrow(/limit/);
    expect(()=>openAttachment(alice,key,'x'.repeat(MAX_SEALED_ATTACHMENT_BYTES+1))).toThrow(/limit/);
    for(const invalid of ['../file','AB'.repeat(32),'ab',''])expect(()=>sealAttachment(alice,invalid,new Uint8Array())).toThrow(/key/);
    for(const malformed of ['null','[]','{}','{"version":2,"nonce":"00","ciphertext":"ff"}',JSON.stringify({...JSON.parse(sealAttachment(alice,key,new Uint8Array())),extra:true})])expect(()=>openAttachment(alice,key,malformed)).toThrow();
  },20000);
});
