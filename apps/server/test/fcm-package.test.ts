import {describe,expect,it} from 'vitest';
import {buildFcmWakeMessage} from '../src/providers.js';

// Regression for 1.0.8: the Play package ru.lastcall.app never received pushes because every
// FCM message was restricted to the direct-test package dev.messenger.prototype.
describe('FCM package targeting',()=>{
 it('does not restrict wake messages to one Android package',()=>{
  const now=1_000_000;
  for(const background of [false,true]){
   const message=buildFcmWakeMessage('token',{kind:'message',intentId:'cc'.repeat(16),expiresAt:now+30_000} as never,now,background) as {android?:Record<string,unknown>};
   expect(message.android).toBeDefined();
   expect(message.android).not.toHaveProperty('restrictedPackageName');
  }
 });
});
