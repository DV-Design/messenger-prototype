package dev.messenger.prototype.calls;
import android.os.*;
import android.telecom.Connection;
import com.facebook.react.bridge.*;
import com.facebook.react.jstasks.*;
import io.wazo.callkeep.VoiceConnectionService;
import java.util.*;

/** One real live P2P call, independent of Expo's short notification task lifetime. */
final class LastCallHostLease {
  private static final Handler handler = new Handler(Looper.getMainLooper());
  private static final Map<String, Lease> held = new HashMap<>();
  private static volatile boolean anyHeld;
  private static final class Lease {
    final ReactApplicationContext context; final int task; Runnable expiry;
    Lease(ReactApplicationContext value, int id) { context = value; task = id; }
  }
  static boolean isHeld() { return anyHeld; }
  static void hold(ReactApplicationContext context, String id) {
    UiThreadUtil.runOnUiThread(() -> {
      if (held.containsKey(id)) return;
      LastCallHeadlessAppLoader.setContext(context);
      WritableNativeMap data = new WritableNativeMap(); data.putString("callId", id);
      int task = HeadlessJsTaskContext.getInstance(context).startTask(new HeadlessJsTaskConfig("lastcall-call-runtime", data, 0, true));
      Lease lease = new Lease(context, task); held.put(id, lease); anyHeld = true;
      lease.expiry = () -> {
        Connection connection = VoiceConnectionService.getConnection(id); if (connection != null) connection.onDisconnect();
        LastCallAudioService.end(context, id);
        // JS normally drains and releases first; this is a native failsafe if the host stopped responding.
        handler.postDelayed(() -> release(id), 5000);
      };
      handler.postDelayed(lease.expiry, 30000);
    });
  }
  static void activate(String id) {
    UiThreadUtil.runOnUiThread(() -> {
      Lease lease = held.get(id); if (lease != null && lease.expiry != null) { handler.removeCallbacks(lease.expiry); lease.expiry = null; }
    });
  }
  static void release(String id) {
    UiThreadUtil.runOnUiThread(() -> {
      Lease lease = held.remove(id); anyHeld = !held.isEmpty(); if (lease == null) return;
      if (lease.expiry != null) handler.removeCallbacks(lease.expiry);
      HeadlessJsTaskContext.getInstance(lease.context).finishTask(lease.task);
      LastCallHeadlessAppLoader.drain();
    });
  }
}
