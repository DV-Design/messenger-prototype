package dev.messenger.prototype.calls;

import android.media.AudioManager;
import android.media.ToneGenerator;
import android.util.Log;

/**
 * What the caller hears while the other phone rings: Android's own ringback tone for the phone's
 * region (425 Hz, 1 s on / 4 s off in Europe and Russia), on the call's voice stream, so it follows
 * the call's output (earpiece, speaker or headset) like a normal phone call.
 */
final class LastCallRingback {
  private static ToneGenerator tone;
  private static String owner;
  private static final String TAG = "LastCallRingback";

  private LastCallRingback() {}

  static synchronized void start(String id) {
    if (id == null || id.isEmpty() || (id.equals(owner) && tone != null)) return;
    release();
    try {
      ToneGenerator next = new ToneGenerator(AudioManager.STREAM_VOICE_CALL, 80);
      if (!next.startTone(ToneGenerator.TONE_SUP_RINGTONE)) { next.release(); Log.w(TAG, "ringback tone refused"); return; }
      tone = next; owner = id;
      Log.i(TAG, "ringback started");
    } catch (RuntimeException error) { release(); Log.w(TAG, "ringback unavailable", error); }
  }

  /** Stops the tone of this call; null stops whatever plays. */
  static synchronized void stop(String id) {
    if (id != null && !id.equals(owner)) return;
    release();
  }

  private static void release() {
    ToneGenerator current = tone;
    tone = null; owner = null;
    if (current == null) return;
    Log.i(TAG, "ringback stopped");
    try { current.stopTone(); } catch (RuntimeException ignored) {}
    try { current.release(); } catch (RuntimeException ignored) {}
  }
}
