import { memo, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { AudioRecorder } from 'expo-audio';
import { appendWaveformSample, waveformLevel, WAVEFORM_CAPACITY, type WaveformSample } from '../waveform-model';
import { colors } from '../styles';

/** Mounted only for this recording attempt; unmount discards the short, local level history. */
export const RecordingWaveform = memo(function RecordingWaveform({ recorder, active }: { recorder: AudioRecorder; active: boolean }) {
  const [{ samples, unavailable }, setWaveform] = useState<{ samples: WaveformSample[]; unavailable: boolean }>({ samples: [], unavailable: false });
  useEffect(() => {
    if (!active) return;
    // The SDK's documented synchronous status includes native dBFS. Poll only while capturing;
    // update the meter/history together once per125ms, independent of the parent's timer renders.
    const timer = setInterval(() => {
      let metering: number | undefined;
      try { const state = recorder.getStatus(); if (!state.isRecording) return; metering = state.metering; } catch { /* A missing/released meter must never invent a signal or crash cancellation. */ }
      setWaveform(previous => ({ samples: appendWaveformSample(previous.samples, metering), unavailable: waveformLevel(metering) === null }));
    }, 125);
    return () => clearInterval(timer);
  }, [active, recorder]);
  const bars = [...Array<WaveformSample>(WAVEFORM_CAPACITY - samples.length).fill(null), ...samples];
  return <View style={{ width: '100%', maxWidth: 320, gap: 12 }}>
    <View accessible accessibilityRole="image" accessibilityLabel="Звуковая дорожка записи с микрофона" style={{ height: 112, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.background, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      {bars.map((level, index) => <View key={index} accessible={false} style={{ flex: 1, minWidth: 1, maxWidth: 4, height: 4 + (level ?? 0) * 80, borderRadius: 2, backgroundColor: level === null ? '#C5D9D2' : colors.accent }} />)}
    </View>
    {active && unavailable && <Text style={{ textAlign: 'center', color: colors.secondary, fontSize: 12 }}>Уровень микрофона недоступен</Text>}
  </View>;
});
