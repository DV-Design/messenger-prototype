package dev.messenger.prototype.notifications;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import org.json.JSONObject;
import java.util.UUID;
import java.util.Map;
import java.nio.charset.StandardCharsets;

/** Platform presentation only: authentication/decryption stay in the shared core. */
public final class LastCallNotificationsModule extends ReactContextBaseJavaModule {
  private static final String CHANNEL = "lastcall-message-previews";
  private static final int NOTIFICATION_ID = 1;
  private final ReactApplicationContext context;
  private static final String OPEN = "dev.messenger.prototype.OPEN_MESSAGE.";
  private final SharedPreferences routes;
  private WritableMap pending;
  private final BaseActivityEventListener activityListener = new BaseActivityEventListener() {
    @Override public void onNewIntent(Intent intent) {
      WritableMap route = consume(intent);
      if (route == null) return;
      synchronized (LastCallNotificationsModule.this) { pending = route; }
      if (context.hasActiveReactInstance()) context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("LastCallNotificationOpened", null);
    }
  };

  public LastCallNotificationsModule(ReactApplicationContext context) {
    super(context); this.context = context;
    routes = context.getSharedPreferences("lastcall-notification-routes-v1", Context.MODE_PRIVATE);
    context.addActivityEventListener(activityListener);
  }
  @Override public void invalidate() { context.removeActivityEventListener(activityListener); super.invalidate(); }
  @ReactMethod public void addListener(String eventName) {}
  @ReactMethod public void removeListeners(double count) {}
  private boolean validConversation(String value) { return value != null && value.matches("(?:dm:[a-f0-9]{64}|group:[a-f0-9]{32})"); }
  private boolean validScope(String value) { return value != null && value.matches("[a-f0-9]{64}"); }
  private synchronized WritableMap consume(Intent intent) {
    if (intent == null || intent.getAction() == null || !intent.getAction().startsWith(OPEN)) return null;
    String action = intent.getAction();
    String saved = routes.getString(action, null);
    if (saved == null) return null;
    try {
      JSONObject route = new JSONObject(saved);
      String conversation = intent.getStringExtra("lastcallConversation");
      String scope = intent.getStringExtra("lastcallScope");
      if (!validConversation(conversation) || !validScope(scope) || !conversation.equals(route.getString("conversationId")) || !scope.equals(route.getString("scope")) || route.getLong("until") <= System.currentTimeMillis()) return null;
      if (!routes.edit().remove(action).commit()) return null;
      WritableMap result = Arguments.createMap(); result.putString("conversationId", conversation); result.putString("scope", scope);
      return result;
    } catch (Exception error) { return null; }
  }
  @ReactMethod public synchronized void getInitialNotification(Promise promise) {
    WritableMap result = pending; pending = null;
    if (result == null && getCurrentActivity() != null) result = consume(getCurrentActivity().getIntent());
    promise.resolve(result);
  }
  @Override public String getName() { return "LastCallNotifications"; }
  private NotificationManager manager() { return (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE); }
  private boolean validId(String id) { return id != null && id.matches("lastcall-message-[a-f0-9]{64}"); }
  private boolean enabled(NotificationManager manager) {
    if (manager == null || !manager.areNotificationsEnabled()) return false;
    return Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
  }
  private boolean ensureChannel(NotificationManager manager) {
    if (!enabled(manager)) return false;
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationChannel channel = new NotificationChannel(CHANNEL, "Текст сообщений LastCall", NotificationManager.IMPORTANCE_HIGH);
      channel.setDescription("Имя отправителя и текст сообщения на экране блокировки");
      channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
      channel.enableVibration(true);
      manager.createNotificationChannel(channel);
      NotificationChannel actual = manager.getNotificationChannel(CHANNEL);
      if (actual == null || actual.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
    }
    return true;
  }
  @ReactMethod public void prepare(Promise promise) {
    try { promise.resolve(ensureChannel(manager())); }
    catch (RuntimeException error) { promise.resolve(false); }
  }
  @ReactMethod public void contains(String id, Promise promise) {
    if (!validId(id)) { promise.resolve(false); return; }
    try {
      NotificationManager manager = manager();
      if (manager != null) for (StatusBarNotification item : manager.getActiveNotifications()) {
        if (id.equals(item.getTag()) && item.getId() == NOTIFICATION_ID) { promise.resolve(true); return; }
      }
      promise.resolve(false);
    } catch (RuntimeException error) { promise.resolve(false); }
  }
  @ReactMethod public synchronized void show(String id, String title, String body, String conversation, String scope, Promise promise) {
    if (!validId(id) || !validConversation(conversation) || !validScope(scope) || title == null || title.isEmpty() || title.length() > 200 || body == null || body.isEmpty() || body.getBytes(StandardCharsets.UTF_8).length > 850) { promise.resolve(false); return; }
    try {
      NotificationManager manager = manager();
      if (!ensureChannel(manager)) { promise.resolve(false); return; }
      Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
      if (intent == null) { promise.resolve(false); return; }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      // Private random action authorizes one tap; public extras alone cannot forge it.
      String action = OPEN + UUID.randomUUID();
      long until = System.currentTimeMillis() + 7L * 24 * 60 * 60 * 1000;
      JSONObject route = new JSONObject(); route.put("conversationId", conversation); route.put("scope", scope); route.put("until", until);
      SharedPreferences.Editor editor = routes.edit();
      int retained = 0; String oldest = null; long oldestUntil = Long.MAX_VALUE;
      for (Map.Entry<String, ?> entry : routes.getAll().entrySet()) {
        try {
          long expires = new JSONObject((String) entry.getValue()).getLong("until");
          if (expires <= System.currentTimeMillis()) editor.remove(entry.getKey());
          else { retained++; if (expires < oldestUntil) { oldestUntil = expires; oldest = entry.getKey(); } }
        }
        catch (Exception error) { editor.remove(entry.getKey()); }
      }
      // A bounded route ledger must never stop new notices when older ones were dismissed.
      if (retained >= 512 && oldest != null) editor.remove(oldest);
      if (!editor.putString(action, route.toString()).commit()) { promise.resolve(false); return; }
      intent.setAction(action);
      intent.putExtra("lastcallConversation", conversation); intent.putExtra("lastcallScope", scope);
      // Extras contain no sender, message text, file name, keys or external URL.
      PendingIntent open = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(android.R.drawable.sym_action_chat)
        .setColor(0xFF6B35B8)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setDefaults(android.app.Notification.DEFAULT_SOUND | android.app.Notification.DEFAULT_VIBRATE)
        .setAutoCancel(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(open);
      manager.notify(id, NOTIFICATION_ID, builder.build());
      promise.resolve(true);
    } catch (Exception error) { promise.resolve(false); }
  }
}
