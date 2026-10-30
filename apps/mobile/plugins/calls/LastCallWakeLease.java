package dev.messenger.prototype.calls;
import android.os.*;
import com.facebook.react.bridge.*;
import com.facebook.react.jstasks.*;
import java.util.*;

/** Bounded data-task timer ownership; duplicate intent IDs never renew the deadline. */
final class LastCallWakeLease {
  private static final Handler handler = new Handler(Looper.getMainLooper());
  private static final Map<String, Lease> held = new HashMap<>();
  private static volatile boolean anyHeld;
  private static final class Lease {
    final ReactApplicationContext context; final int task; final Runnable expiry;
    Lease(ReactApplicationContext value, int taskId, Runnable timeout) { context = value; task = taskId; expiry = timeout; }
  }
  static boolean isHeld() { return anyHeld; }
  static void hold(ReactApplicationContext context, String id, Promise result) {
    UiThreadUtil.runOnUiThread(() -> {
      if (id == null || !id.matches("[a-f0-9]{32}")) { result.reject("WAKE_INVALID", "Invalid bounded intent"); return; }
      if (held.containsKey(id)) { result.resolve(true); return; }
      if (held.size() >= 32) { result.reject("WAKE_BUSY", "Too many background windows"); return; }
      try {
        LastCallHeadlessAppLoader.setContext(context);
        WritableNativeMap data = new WritableNativeMap(); data.putString("intentId", id);
        int task = HeadlessJsTaskContext.getInstance(context).startTask(new HeadlessJsTaskConfig("lastcall-wake-runtime", data, 12000, true));
        Runnable expiry = () -> release(id); held.put(id, new Lease(context, task, expiry)); anyHeld = true;
        handler.postDelayed(expiry, 12000); result.resolve(true);
      } catch (Exception error) { result.reject("WAKE_UNAVAILABLE", "Background timer ownership unavailable"); }
    });
  }
  static void release(String id) {
    UiThreadUtil.runOnUiThread(() -> {
      Lease lease = held.remove(id); anyHeld = !held.isEmpty(); if (lease == null) return;
      handler.removeCallbacks(lease.expiry); HeadlessJsTaskContext.getInstance(lease.context).finishTask(lease.task);
      LastCallHeadlessAppLoader.drain();
    });
  }
}
