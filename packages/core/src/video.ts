export interface VideoMeasurements {availableOutgoingBitrate?:number;rttMs?:number;lossRatio?:number;}
export interface VideoTarget {active:boolean;maxBitrate:number;maxFramerate:number;scaleResolutionDownBy:number;}
const tiers=[
  {maxBitrate:40000,maxFramerate:5,scaleResolutionDownBy:4},
  {maxBitrate:120000,maxFramerate:10,scaleResolutionDownBy:4},
  {maxBitrate:300000,maxFramerate:15,scaleResolutionDownBy:2},
  {maxBitrate:650000,maxFramerate:24,scaleResolutionDownBy:1.5},
  {maxBitrate:1200000,maxFramerate:30,scaleResolutionDownBy:1},
] as const;
const target=(level:number):VideoTarget=>({active:level>=0,...tiers[Math.max(0,level)]!});
/** Caps above native GCC. Reserve voice+packet overhead; degrade now, recover one tier/10s. */
export class AdaptiveVideoPolicy {
  private level=2;
  private recoverySince?:number;
  private lastTime=-Infinity;
  current():VideoTarget{return target(this.level);}
  update(measurements:VideoMeasurements,now:number):VideoTarget {
    if(!Number.isFinite(now))return this.current();
    if(now<this.lastTime)this.recoverySince=undefined;
    this.lastTime=now;
    const valid=(value:number|undefined)=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
    const rtt=valid(measurements.rttMs)?measurements.rttMs!:0;
    const loss=valid(measurements.lossRatio)?Math.min(1,measurements.lossRatio!):0;
    const budget=valid(measurements.availableOutgoingBitrate)?Math.max(0,measurements.availableOutgoingBitrate!*0.8-64000):undefined;
    let desired=loss>0.12||rtt>700?0:loss>0.05||rtt>350?1:loss>0.02||rtt>180?2:4;
    // Some stacks omit the bandwidth estimate: healthy RTCP can restore the conservative start cap.
    if(budget===undefined)desired=Math.min(desired,2);
    if(budget!==undefined){
      if(budget<24000)desired=-1;
      else {while(desired>0&&tiers[desired]!.maxBitrate>budget)desired--;}
    }
    if(desired<this.level){this.level=desired;this.recoverySince=undefined;}
    else if(desired>this.level&&loss<=0.02&&rtt<=180&&(budget===undefined
      ?valid(measurements.rttMs)||valid(measurements.lossRatio)
      :budget>=tiers[Math.max(0,this.level+1)]!.maxBitrate*1.2)){
      this.recoverySince??=now;
      if(now-this.recoverySince>=10000){this.level++;this.recoverySince=undefined;}
    }else this.recoverySince=undefined;
    const result=this.current();
    // At the lowest tier, a small positive budget is still a real upper bound.
    if(budget!==undefined)result.maxBitrate=Math.max(1,Math.min(result.maxBitrate,Math.floor(budget)));
    return result;
  }
}
