export interface AudioMeasurements {rttMs?:number;lossRatio?:number;}
/** Bounded policy targets encoder bitrate, not total link bandwidth or intelligibility guarantees. */
export function audioPolicy(measurements:AudioMeasurements):{maxBitrate:number} {
  const rtt=Number.isFinite(measurements.rttMs)?Math.max(0,measurements.rttMs!):0;
  const loss=Number.isFinite(measurements.lossRatio)?Math.max(0,Math.min(1,measurements.lossRatio!)):0;
  return {maxBitrate:loss>0.12||rtt>700?12000:loss>0.05||rtt>350?18000:loss>0.02||rtt>180?24000:32000};
}
