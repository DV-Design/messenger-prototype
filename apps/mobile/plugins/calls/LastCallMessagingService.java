package dev.messenger.prototype.calls;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.RemoteMessage;
import expo.modules.notifications.service.ExpoFirebaseMessagingService;
import java.util.Map;

/**
 * Takes the CPU wake lock the moment FCM delivers, before a cold React Native start. Expo's service
 * returns right after queueing JS, and FCM's own wake lock ends with it. All verification and
 * presentation stay in the existing path: this neither rings nor shows content.
 */
public final class LastCallMessagingService extends ExpoFirebaseMessagingService {
  private static final long CALL_MS = 28_000;
  private static final long DATA_MS = 12_000;
  private static final long STATE_MS = 6_000;

  @Override public void onMessageReceived(@NonNull RemoteMessage message) {
    try { prepare(message.getData()); } catch (RuntimeException ignored) { /* Delivery continues below. */ }
    super.onMessageReceived(message);
  }

  private void prepare(Map<String, String> data) {
    String kind = data.get("kind");
    if ("lastcall-call".equals(kind)) {
      String id = data.get("intentId");
      long expiresAt = parse(data.get("expiresAt"));
      long remaining = expiresAt - System.currentTimeMillis();
      if (id == null || !id.matches("[a-f0-9]{32}") || remaining <= 0) return;
      LastCallCpuWake.hold(this, id, Math.min(CALL_MS, remaining));
      LastCallCallTrace.add(this, "push-call");
      // High-priority FCM allows this now; by the time a cold JS start asks, it may not.
      LastCallCallSetupService.begin(this, id, expiresAt);
    } else if ("lastcall-call-state".equals(kind)) {
      String id = data.get("callId");
      if (id != null && id.matches("[a-f0-9]{32}")) LastCallCpuWake.hold(this, id, STATE_MS);
      LastCallCallTrace.add(this, "push-call-state");
    } else if ("lastcall-wake".equals(kind)) {
      String id = data.get("intentId");
      if (id != null && id.matches("[a-f0-9]{32}")) LastCallCpuWake.hold(this, id, DATA_MS);
      LastCallCallTrace.add(this, "push-data");
    }
  }

  private static long parse(String value) {
    try { return value == null ? 0 : Long.parseLong(value); }
    catch (NumberFormatException invalid) { return 0; }
  }
}
