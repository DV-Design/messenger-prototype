package dev.messenger.prototype.calls;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import com.facebook.react.bridge.Promise;

/** Only started after an explicit answer, never by push or while merely ringing. */
public final class LastCallAudioService extends Service {
  private static Promise pending;
  private static String pendingId;
  private static String runningId;
  static synchronized void begin(Context context, String id, boolean video, Promise promise) {
    if (pending != null) { promise.reject("CALL_BUSY", "Audio service is starting"); return; }
    pending = promise; pendingId = id;
    try {
      Intent intent = new Intent(context, LastCallAudioService.class).putExtra("callId", id).putExtra("video", video);
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent); else context.startService(intent);
      new Handler(Looper.getMainLooper()).postDelayed(() -> { synchronized (LastCallAudioService.class) {
        if (id.equals(pendingId) && pending != null) { end(context, id); }
      } }, 5000);
    } catch (Exception error) { pending = null; pendingId = null; promise.reject("CALL_FGS_DENIED", "Android did not allow call microphone service"); }
  }
  static synchronized void end(Context context, String id) {
    boolean stop = id.equals(runningId) || id.equals(pendingId);
    if (id.equals(pendingId)) { if (pending != null) pending.reject("CALL_CANCELLED", "Call ended or audio service timed out"); pending = null; pendingId = null; }
    if (id.equals(runningId)) runningId = null;
    if (stop) context.stopService(new Intent(context, LastCallAudioService.class));
  }
  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    String id = intent == null ? null : intent.getStringExtra("callId");
    boolean video = intent != null && intent.getBooleanExtra("video", false);
    Promise result;
    synchronized (LastCallAudioService.class) {
      if (id == null || !id.equals(pendingId) || pending == null) { if (pending == null && runningId == null) stopSelf(startId); return START_NOT_STICKY; }
      result = pending; pending = null; pendingId = null;
    }
    try {
      NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
      if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel("lastcall-active-call", "Разговор LastCall", NotificationManager.IMPORTANCE_LOW));
      Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
      PendingIntent open = PendingIntent.getActivity(this, 86, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "lastcall-active-call") : new Notification.Builder(this);
      Notification notification = builder.setSmallIcon(getApplicationInfo().icon).setContentTitle("LastCall · разговор").setContentText(video ? "Камера и микрофон включены для звонка" : "Микрофон включён для принятого звонка").setOngoing(true).setCategory(Notification.CATEGORY_CALL).setContentIntent(open).build();
      if (Build.VERSION.SDK_INT >= 29) startForeground(851, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL | ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE | (video ? ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA : 0));
      else startForeground(851, notification);
      synchronized (LastCallAudioService.class) { runningId = id; }
      LastCallHostLease.activate(id);
      result.resolve(true);
    } catch (Exception error) { result.reject("CALL_FGS_DENIED", "Android did not allow call microphone service"); stopSelf(); }
    return START_NOT_STICKY;
  }
  @Override public void onDestroy() { if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true); super.onDestroy(); }
  @Override public IBinder onBind(Intent intent) { return null; }
}
