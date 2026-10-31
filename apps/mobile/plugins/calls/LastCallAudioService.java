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
  private static boolean runningActive;
  private static Runnable runningDeadline;
  private static final Handler handler = new Handler(Looper.getMainLooper());
  private String boundId;
  static synchronized void begin(Context context, String id, boolean video, Promise promise) {
    if (pending != null) { promise.reject("CALL_BUSY", "Audio service is starting"); return; }
    LastCallCallUiService.Entry entry = LastCallCallUiService.current();
    boolean incoming = id != null && id.contains("-");
    if (incoming && (entry == null || !id.equals(entry.uuid) || entry.expiresAt <= System.currentTimeMillis())) { promise.reject("CALL_EXPIRED", "Incoming call is no longer current"); return; }
    pending = promise; pendingId = id;
    try {
      Intent intent = new Intent(context, LastCallAudioService.class).putExtra("callId", id).putExtra("video", video).putExtra("deadline", incoming ? entry.expiresAt : 0L);
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent); else context.startService(intent);
      new Handler(Looper.getMainLooper()).postDelayed(() -> { synchronized (LastCallAudioService.class) {
        if (id.equals(pendingId) && pending != null) { end(context, id); }
      } }, 5000);
    } catch (Exception error) { pending = null; pendingId = null; promise.reject("CALL_FGS_DENIED", "Android did not allow call microphone service"); }
  }
  static synchronized void end(Context context, String id) {
    boolean stop = id.equals(runningId) || id.equals(pendingId);
    if (id.equals(pendingId)) { if (pending != null) pending.reject("CALL_CANCELLED", "Call ended or audio service timed out"); pending = null; pendingId = null; }
    if (id.equals(runningId)) { runningId = null; runningActive = false; if (runningDeadline != null) handler.removeCallbacks(runningDeadline); runningDeadline = null; }
    if (stop) context.stopService(new Intent(context, LastCallAudioService.class));
  }
  static synchronized void endPending(Context context, String id) {
    if (!runningActive || !id.equals(runningId)) end(context, id);
  }
  /** Only core's actual active-session observation removes the original pending-answer deadline. */
  static void activate(Context context, String id) {
    synchronized (LastCallAudioService.class) {
      if (!id.equals(runningId)) return;
      runningActive = true;
      if (runningDeadline != null) handler.removeCallbacks(runningDeadline); runningDeadline = null;
    }
    LastCallHostLease.activate(id);
    LastCallCallUiService.stop(context, id);
  }
  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    String id = intent == null ? null : intent.getStringExtra("callId");
    boolean video = intent != null && intent.getBooleanExtra("video", false);
    long deadline = intent == null ? 0 : intent.getLongExtra("deadline", 0);
    Promise result;
    synchronized (LastCallAudioService.class) {
      if (id == null || !id.equals(pendingId) || pending == null) { if (pending == null && runningId == null) stopSelf(startId); return START_NOT_STICKY; }
      result = pending; pending = null; pendingId = null;
    }
    try {
      if (deadline != 0 && deadline <= System.currentTimeMillis()) throw new IllegalStateException("Call expired");
      NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
      if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel("lastcall-active-call", "Разговор LastCall", NotificationManager.IMPORTANCE_LOW));
      Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
      PendingIntent open = PendingIntent.getActivity(this, 86, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "lastcall-active-call") : new Notification.Builder(this);
      Notification notification = builder.setSmallIcon(getApplicationInfo().icon).setContentTitle("LastCall · разговор").setContentText(video ? "Камера и микрофон включены для звонка" : "Микрофон включён для принятого звонка").setOngoing(true).setCategory(Notification.CATEGORY_CALL).setContentIntent(open).build();
      if (Build.VERSION.SDK_INT >= 29) startForeground(851, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL | ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE | (video ? ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA : 0));
      else startForeground(851, notification);
      synchronized (LastCallAudioService.class) {
        runningId = id; boundId = id; runningActive = deadline == 0;
        if (runningDeadline != null) handler.removeCallbacks(runningDeadline);
        if (deadline != 0) {
          runningDeadline = () -> {
            synchronized (LastCallAudioService.class) {
              if (!id.equals(runningId) || runningActive) return;
              end(getApplicationContext(), id);
            }
            LastCallCallUiService.expirePendingAudio(id);
          };
          handler.postDelayed(runningDeadline, Math.max(0, deadline - System.currentTimeMillis()));
        } else { runningDeadline = null; LastCallHostLease.activate(id); }
      }
      result.resolve(true);
    } catch (Exception error) { result.reject("CALL_FGS_DENIED", "Android did not allow call microphone service"); stopSelf(); }
    return START_NOT_STICKY;
  }
  @Override public void onDestroy() {
    synchronized (LastCallAudioService.class) {
      if (boundId != null && boundId.equals(runningId)) { runningId = null; runningActive = false; if (runningDeadline != null) handler.removeCallbacks(runningDeadline); runningDeadline = null; }
    }
    if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true); super.onDestroy();
  }
  @Override public IBinder onBind(Intent intent) { return null; }
}
