export interface VideoMeasurements {availableOutgoingBitrate?:number;rttMs?:number;lossRatio?:number;}
export interface VideoTarget {active:boolean;maxBitrate:number;maxFramerate:number;scaleResolutionDownBy:number;}
const tiers=[
  {maxBitrate:40000,maxFramerate:5,scaleResolutionDownBy:4},
  {maxBitrate:120000,maxFramerate:10,scaleResolutionDownBy:4},
  {maxBitrate:450000,maxFramerate:20,scaleResolutionDownBy:2},
  {maxBitrate:900000,maxFramerate:24,scaleResolutionDownBy:1.5},
  {maxBitrate:1800000,maxFramerate:30,scaleResolutionDownBy:1},
] as const;
const target=(level:number):VideoTarget=>({active:level>=0,...tiers[Math.max(0,level)]!});
/** These are ceilings, not forced rates: native GCC still controls actual sending.
 * Keep full capture quality unless receiver loss or a real bandwidth estimate
 * requires a smaller envelope. A long but uncongested route is not low bandwidth.
 */
export class AdaptiveVideoPolicy {
  private level=4;
  private recoverySince?:number;
  private pressureSince?:number;
  private lastTime=-Infinity;
  current():VideoTarget{return target(this.level);}
  update(measurements:VideoMeasurements,now:number):VideoTarget {
    if(!Number.isFinite(now))return this.current();
    if(now<this.lastTime){this.recoverySince=undefined;this.pressureSince=undefined;}
    this.lastTime=now;
    const valid=(value:number|undefined)=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
    const loss=valid(measurements.lossRatio)?Math.min(1,measurements.lossRatio!):0;
    const budget=valid(measurements.availableOutgoingBitrate)?Math.max(0,measurements.availableOutgoingBitrate!*0.8-64000):undefined;
    if(loss>0.02)this.pressureSince??=now;else this.pressureSince=undefined;
    // Ignore one moderate-loss sample; GCC handles short bursts without a resolution jump.
    const sustainedLoss=this.pressureSince!==undefined&&now-this.pressureSince>=2000;
    let desired=loss>0.12?0:sustainedLoss?(loss>0.05?1:2):4;
    if(budget!==undefined){
      if(budget<24000)desired=-1;
      else {while(desired>0&&tiers[desired]!.maxBitrate>budget)desired--;}
    }
    if(desired<this.level){this.level=desired;this.recoverySince=undefined;}
    else if(desired>this.level&&loss<=0.02&&(budget===undefined||budget>=tiers[Math.max(0,this.level+1)]!.maxBitrate*1.1)){
      this.recoverySince??=now;
      // Missing native estimates must not pin the encoder at a tiny old cap forever.
      // Probe more slowly with no feedback; GCC may always choose a lower actual rate.
      const recoveryMs=budget!==undefined||valid(measurements.lossRatio)?4000:8000;
      if(now-this.recoverySince>=recoveryMs){this.level++;this.recoverySince=undefined;}
    }else this.recoverySince=undefined;
    const result=this.current();
    // At the lowest tier, a small positive budget is still a real upper bound.
    if(budget!==undefined)result.maxBitrate=Math.max(1,Math.min(result.maxBitrate,Math.floor(budget)));
    return result;
  }
}
