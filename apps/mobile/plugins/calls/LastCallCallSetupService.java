package dev.messenger.prototype.calls;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import java.util.HashMap;
import java.util.Map;

/**
 * Short phoneCall-only setup window. It never opens the microphone and has its own notification,
 * so stopping it cannot stop the independent active-audio service.
 */
public final class LastCallCallSetupService extends Service {
  private static final String CHANNEL_ID = "lastcall-call-setup";
  private static final int NOTIFICATION_ID = 853;
  private static final Handler handler = new Handler(Looper.getMainLooper());
  private static final Map<String, Runnable> held = new HashMap<>();
  private static String boundId;

  static synchronized void begin(Context context, String id, long expiresAt) {
    if (Build.VERSION.SDK_INT < 26 || id == null || !id.matches("[a-f0-9]{32}")) return;
    long duration = Math.min(30_000, expiresAt - System.currentTimeMillis());
    if (duration <= 0) return;
    if (held.containsKey(id)) return; // Duplicates never extend the window.
    for (Runnable previous : held.values()) handler.removeCallbacks(previous);
    held.clear(); // One call at a time; a new call replaces the old setup window.
    ensureChannel(context);
    try {
      Intent intent = new Intent(context, LastCallCallSetupService.class).putExtra("callId", id);
      context.startForegroundService(intent);
    } catch (Exception error) {
      return;
    }
    Runnable expiry = () -> end(context, id);
    held.put(id, expiry);
    handler.postDelayed(expiry, duration);
  }

  static synchronized void end(Context context, String id) {
    Runnable expiry = held.remove(id);
    if (expiry == null) return;
    handler.removeCallbacks(expiry);
    if (held.isEmpty()) context.stopService(new Intent(context, LastCallCallSetupService.class));
  }

  /** The incoming call UI supersedes the short connecting notice. */
  static synchronized void endAll(Context context) {
    for (Runnable expiry : held.values()) handler.removeCallbacks(expiry);
    held.clear();
    context.stopService(new Intent(context, LastCallCallSetupService.class));
  }

  private static void ensureChannel(Context context) {
    NotificationManager manager = (NotificationManager) context.getSystemService(NOTIFICATION_SERVICE);
    if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
    NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Подключение звонка LastCall", NotificationManager.IMPORTANCE_LOW);
    channel.setDescription("Подготовка защищённого звонка без доступа к микрофону");
    channel.setSound(null, null);
    manager.createNotificationChannel(channel);
  }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    String id = intent == null ? null : intent.getStringExtra("callId");
    synchronized (LastCallCallSetupService.class) {
      if (id == null || !held.containsKey(id)) { stopSelf(startId); return START_NOT_STICKY; }
      boundId = id;
    }
    Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
    PendingIntent pending = open == null ? null : PendingIntent.getActivity(this, 87, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(getApplicationInfo().icon)
      .setContentTitle("LastCall")
      .setContentText("Подключение защищённого звонка")
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setSilent(true);
    if (pending != null) builder.setContentIntent(pending);
    try {
      if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, builder.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
      else startForeground(NOTIFICATION_ID, builder.build());
    } catch (Exception error) { stopSelf(startId); }
    return START_NOT_STICKY;
  }

  @Override public void onDestroy() {
    if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
    NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    if (manager != null) manager.cancel(NOTIFICATION_ID);
    synchronized (LastCallCallSetupService.class) {
      if (boundId != null) { Runnable expiry = held.remove(boundId); if (expiry != null) handler.removeCallbacks(expiry); }
      boundId = null;
    }
    super.onDestroy();
  }

  @Override public IBinder onBind(Intent intent) { return null; }
}
