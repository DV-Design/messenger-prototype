import {randomBytes} from 'node:crypto';
import type {CallState} from '@messenger/core';

export class CallControlError extends Error {
  constructor(readonly code:string,message:string){super(message);}
}
export type CallTiming={callId:string;serverEpoch:string;issuedAt:number;expiresAt:number};
export type CallAction='accept'|'decline'|'cancel'|'end';
type Transition={value:CallState;changed:boolean};
/** Coordination metadata only: never retain encrypted invitations or media. */
export class CallRegistry {
  readonly epoch=randomBytes(16).toString('hex');
  private calls=new Map<string,CallState>();
  constructor(private now:()=>number=Date.now,private maxGlobal=4096,private maxPerUser=8){}
  expire(){for(const [id,value] of this.calls)if(this.now()>=value.expiresAt)this.calls.delete(id);}
  clear(){this.calls.clear();}
  private timing(value:CallTiming){
    const now=this.now();
    if(value.serverEpoch!==this.epoch)throw new CallControlError('call-epoch','Call server epoch changed');
    if(!Number.isSafeInteger(value.issuedAt)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt-value.issuedAt!==30000||value.issuedAt>now+5000||value.expiresAt<=now||value.expiresAt>now+35000)throw new CallControlError('call-expired','Call deadline is invalid or expired');
  }
  private unknown(actor:string,other:string,callId:string):CallState {
    const now=this.now();return {callerId:actor,calleeId:other,callId,serverEpoch:this.epoch,issuedAt:now,expiresAt:now,state:'unknown',revision:0};
  }
  private participants(value:CallState,actor:string,other:string){return value.callerId===actor&&value.calleeId===other||value.calleeId===actor&&value.callerId===other;}
  state(actor:string,other:string,callId:string,epoch:string):CallState {
    this.expire();const value=this.calls.get(callId);
    if(epoch!==this.epoch||!value||!this.participants(value,actor,other))return this.unknown(actor,other,callId);
    return {...value};
  }
  private insert(value:CallState){
    this.expire();
    if(this.calls.size>=this.maxGlobal||[value.callerId,value.calleeId].some(user=>[...this.calls.values()].filter(c=>c.callerId===user||c.calleeId===user).length>=this.maxPerUser))throw new CallControlError('call-busy','Call coordination capacity reached');
    this.calls.set(value.callId,value);
  }
  offer(caller:string,callee:string,timing:CallTiming):Transition {
    this.timing(timing);if(caller===callee)throw new CallControlError('call-target','Cannot call self');this.expire();
    const existing=this.calls.get(timing.callId);
    if(existing){
      if(existing.callerId!==caller||existing.calleeId!==callee||existing.issuedAt!==timing.issuedAt||existing.expiresAt!==timing.expiresAt)throw new CallControlError('call-mismatch','Call identity is already bound');
      return {value:{...existing},changed:false};
    }
    const value:CallState={callId:timing.callId,serverEpoch:timing.serverEpoch,issuedAt:timing.issuedAt,expiresAt:timing.expiresAt,callerId:caller,calleeId:callee,state:'pending',revision:1};this.insert(value);return {value:{...value},changed:true};
  }
  received(callee:string,caller:string,callId:string,epoch:string):Transition {
    const value=this.state(callee,caller,callId,epoch);
    if(value.state==='unknown')return {value,changed:false};
    if(value.calleeId!==callee||value.callerId!==caller)throw new CallControlError('call-role','Only the callee may acknowledge ringing');
    if(value.state!=='pending')return {value,changed:false};
    return this.change(value,'ringing');
  }
  action(actor:string,other:string,action:CallAction,timing:CallTiming):Transition {
    this.expire();let value=this.calls.get(timing.callId);
    if(timing.serverEpoch!==this.epoch)return {value:this.unknown(actor,other,timing.callId),changed:false};
    if(!value){
      // A caller cancellation can overtake an asynchronous offer. Its tombstone
      // owns exactly the original deadline and prevents resurrection by that offer.
      if(action!=='cancel')return {value:this.unknown(actor,other,timing.callId),changed:false};
      this.timing(timing);if(actor===other)throw new CallControlError('call-target','Cannot call self');
      value={callId:timing.callId,serverEpoch:timing.serverEpoch,issuedAt:timing.issuedAt,expiresAt:timing.expiresAt,callerId:actor,calleeId:other,state:'ended',revision:1};this.insert(value);return {value:{...value},changed:true};
    }
    if(!this.participants(value,actor,other)||value.issuedAt!==timing.issuedAt||value.expiresAt!==timing.expiresAt)throw new CallControlError('call-mismatch','Call action participant or deadline mismatch');
    if((action==='cancel'&&actor!==value.callerId)||((action==='accept'||action==='decline')&&actor!==value.calleeId))throw new CallControlError('call-role','Call action is not allowed for this participant');
    if(value.state==='ended')return {value:{...value},changed:false};
    if(action==='accept'){if(value.state==='accepted')return {value:{...value},changed:false};return this.change(value,'accepted');}
    return this.change(value,'ended');
  }
  private change(value:CallState,state:CallState['state']):Transition {
    const next={...value,state,revision:value.revision+1};this.calls.set(value.callId,next);return {value:{...next},changed:true};
  }
}
