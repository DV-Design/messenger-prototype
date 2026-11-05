package dev.messenger.prototype.calls;

import android.content.Context;
import com.oney.WebRTCModule.WebRTCModuleOptions;
import org.webrtc.audio.JavaAudioDeviceModule;

/**
 * The only way to hear this person's speech during a call: Android gives the microphone to WebRTC, and
 * a recognizer opening its own fails. Identical to react-native-webrtc's default module plus this callback.
 */
public final class LastCallAudioTap {
  interface Sink { void onSamples(byte[] data, int sampleRate, int channels); }
  private static volatile Sink sink;
  private LastCallAudioTap() {}

  /** Must run before WebRTCModule is created, so it runs in Application.onCreate. */
  public static void install(Context context) {
    WebRTCModuleOptions.getInstance().audioDeviceModule = JavaAudioDeviceModule.builder(context.getApplicationContext())
      .setEnableVolumeLogger(false)
      .setSamplesReadyCallback(samples -> {
        Sink current = sink;
        if (current != null) current.onSamples(samples.getData(), samples.getSampleRate(), samples.getChannelCount());
      })
      .createAudioDeviceModule();
  }
  static void setSink(Sink value) { sink = value; }
}
