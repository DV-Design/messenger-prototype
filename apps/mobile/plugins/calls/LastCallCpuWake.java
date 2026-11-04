package dev.messenger.prototype.calls;

import android.content.Context;
import android.os.PowerManager;
import android.os.SystemClock;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * Keeps the CPU running for a bounded push or ringing window. A foreground service or a headless
 * task does not do this: with the screen off a real phone suspends as soon as FCM's own short
 * wake lock ends, which stops JS before it can verify a call or decrypt a preview.
 */
final class LastCallCpuWake {
  private static final long MAX_MS = 35_000;
  private static final Map<String, Long> held = new HashMap<>();
  private static PowerManager.WakeLock lock;

  static synchronized void hold(Context context, String id, long durationMs) {
    if (id == null || durationMs <= 0) return;
    long now = SystemClock.elapsedRealtime();
    long until = now + Math.min(durationMs, MAX_MS);
    Long previous = held.get(id);
    // Duplicates never extend a window.
    if (previous != null && previous > now) until = previous;
    held.put(id, until);
    apply(context, now);
  }

  static synchronized void release(String id) {
    if (id == null || held.remove(id) == null) return;
    apply(null, SystemClock.elapsedRealtime());
  }

  private static void apply(Context context, long now) {
    long latest = 0;
    for (Iterator<Long> values = held.values().iterator(); values.hasNext();) {
      long until = values.next();
      if (until <= now) values.remove(); else latest = Math.max(latest, until);
    }
    try {
      if (latest == 0) { if (lock != null && lock.isHeld()) lock.release(); return; }
      if (lock == null) {
        if (context == null) return;
        PowerManager power = (PowerManager) context.getApplicationContext().getSystemService(Context.POWER_SERVICE);
        if (power == null) return;
        lock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LastCall:wake");
        lock.setReferenceCounted(false);
      }
      // Not reference counted: this restarts the single timeout at the latest live deadline.
      lock.acquire(latest - now);
    } catch (RuntimeException ignored) {
      // A power-service failure must not break the call or notification path.
    }
  }

  private LastCallCpuWake() {}
}
