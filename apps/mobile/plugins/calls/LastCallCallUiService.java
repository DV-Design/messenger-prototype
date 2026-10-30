package dev.messenger.prototype.calls;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import androidx.core.app.Person;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.telecom.Connection;
import android.telecom.PhoneAccount;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import io.wazo.callkeep.VoiceConnectionService;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

/**
 * App-owned ringing UI for Android self-managed calls. CallKeep passes the live UUID through
 * showIncomingCallUi; this service posts the call-style notification and the call-only activity.
 * No microphone, camera or chat history is opened here.
 */
public final class LastCallCallUiService extends Service {
  static final String ACTION_INCOMING = "dev.messenger.prototype.calls.action.INCOMING";
  static final String ACTION_ANSWER = "dev.messenger.prototype.calls.action.ANSWER";
  static final String ACTION_DECLINE = "dev.messenger.prototype.calls.action.DECLINE";
  static final String EXTRA_UUID = "uuid";
  static final String EXTRA_NAME = "name";
  static final String EXTRA_VIDEO = "video";
  static final String EXTRA_NONCE = "nonce";
  static final String EXTRA_EXPIRES = "expires";
  private static final String CHANNEL_ID = "lastcall-incoming-calls";
  private static final int NOTIFICATION_ID = 852;
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final Handler handler = new Handler(Looper.getMainLooper());
  private static volatile Entry active;
  private static volatile WeakReference<Activity> screen = new WeakReference<>(null);
  private static volatile String screenUuid;
  private Entry bound;

  static final class Entry {
    final String uuid;
    final String name;
    final boolean video;
    final String nonce;
    final long startedAt;
    final long expiresAt;
    final Context context;
    Runnable expiry;
    Entry(Context app, String value, String caller, boolean hasVideo, String secret, long started, long expiry) {
      context = app.getApplicationContext(); uuid = value; name = caller; video = hasVideo; nonce = secret; startedAt = started; expiresAt = expiry;
    }
  }

  static final class Status {
    boolean supported;
    boolean notifications;
    boolean channel;
    boolean fullScreen;
  }

  static synchronized boolean begin(Context context, String uuid, String name, boolean video, long expiresAt) {
    if (Build.VERSION.SDK_INT < 24 || uuid == null
        || !uuid.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")) return false;
    long now = System.currentTimeMillis();
    if (expiresAt <= now) return false;
    long deadline = Math.min(expiresAt, now + 30_000);
    LastCallCallSetupService.endAll(context);
    // Duplicate notices never extend the deadline or rotate the nonce.
    Entry previous = active;
    if (previous != null && previous.uuid.equals(uuid)) return true;
    if (previous != null) {
      if (previous.expiry != null) handler.removeCallbacks(previous.expiry);
      finishScreen(previous.uuid);
    }
    byte[] secret = new byte[24]; RANDOM.nextBytes(secret);
    Entry entry = new Entry(context, uuid, name == null || name.isEmpty() ? "LastCall" : name, video, hex(secret), now, deadline);
    entry.expiry = () -> expire(entry);
    active = entry;
    handler.postDelayed(entry.expiry, deadline - now);
    ensureChannel(context);
    try {
      Intent intent = new Intent(context, LastCallCallUiService.class).setAction(ACTION_INCOMING);
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent); else context.startService(intent);
      return true;
    } catch (Exception error) {
      handler.removeCallbacks(entry.expiry);
      if (active == entry) active = null;
      return false;
    }
  }

  private static void expire(Entry entry) {
    synchronized (LastCallCallUiService.class) {
      // A stale timer from an old entry must never touch the current call.
      if (active != entry) return;
      // Close only this ringing self-managed connection; never answer or capture media.
      if (Build.VERSION.SDK_INT >= 26) {
        Connection connection = VoiceConnectionService.getConnection(entry.uuid);
        if (connection != null) connection.onReject();
      } else {
        // Android 7 has no Telecom connection; ask the live JS runtime to end this same UUID.
        dispatchAction(entry.context, entry.uuid, ACTION_DECLINE);
      }
      stopLocked(entry.context, entry.uuid);
    }
  }

  static synchronized Entry validate(Intent intent) {
    if (intent == null) return null;
    String action = intent.getAction();
    if (!ACTION_INCOMING.equals(action) && !ACTION_ANSWER.equals(action) && !ACTION_DECLINE.equals(action)) return null;
    ComponentName component = intent.getComponent();
    if (component == null || !LastCallCallActivity.class.getName().equals(component.getClassName())) return null;
    Entry entry = active;
    if (entry == null) return null;
    String uuid = intent.getStringExtra(EXTRA_UUID);
    String nonce = intent.getStringExtra(EXTRA_NONCE);
    long expires = intent.getLongExtra(EXTRA_EXPIRES, 0);
    if (uuid == null || nonce == null || !uuid.equals(entry.uuid) || expires != entry.expiresAt) return null;
    if (System.currentTimeMillis() > entry.expiresAt) return null;
    return MessageDigest.isEqual(nonce.getBytes(StandardCharsets.UTF_8), entry.nonce.getBytes(StandardCharsets.UTF_8)) ? entry : null;
  }

  static synchronized Entry current() { return active; }

  static void bindScreen(Activity activity, String uuid) {
    screen = new WeakReference<>(activity); screenUuid = uuid;
  }

  static void clearScreen(Activity activity) {
    if (screen.get() == activity) { screen.clear(); screenUuid = null; }
  }

  /** Package-local action bridge for Android 7, which has no Telecom connection object. */
  static void dispatchAction(Context context, String uuid, String action) {
    if (ACTION_ANSWER.equals(action)) LastCallAudioModule.dispatch(uuid, "answer");
    else if (ACTION_DECLINE.equals(action)) LastCallAudioModule.dispatch(uuid, "end");
  }

  private static void finishScreen(String uuid) {
    Activity visible = screen.get();
    if (visible == null || uuid == null || !uuid.equals(screenUuid)) return;
    screen.clear(); screenUuid = null;
    visible.runOnUiThread(() -> { if (!visible.isFinishing()) visible.finish(); });
  }

  static synchronized void stop(Context context, String uuid) {
    if (active == null || uuid == null || !active.uuid.equals(uuid)) return;
    stopLocked(context, uuid);
  }

  private static void stopLocked(Context context, String uuid) {
    Entry entry = active;
    if (entry == null || !entry.uuid.equals(uuid)) return;
    active = null;
    if (entry.expiry != null) handler.removeCallbacks(entry.expiry);
    finishScreen(uuid);
    NotificationManager manager = (NotificationManager) context.getSystemService(NOTIFICATION_SERVICE);
    if (manager != null) manager.cancel(NOTIFICATION_ID);
    context.stopService(new Intent(context, LastCallCallUiService.class));
  }

  private static String hex(byte[] bytes) {
    StringBuilder builder = new StringBuilder(bytes.length * 2);
    for (byte value : bytes) builder.append(String.format("%02x", value));
    return builder.toString();
  }

  private static void ensureChannel(Context context) {
    if (Build.VERSION.SDK_INT < 26) return;
    NotificationManager manager = (NotificationManager) context.getSystemService(NOTIFICATION_SERVICE);
    if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
    NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Входящие звонки LastCall", NotificationManager.IMPORTANCE_HIGH);
    channel.setDescription("Входящие звонки LastCall");
    Uri ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
    AudioAttributes audio = new AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
    channel.setSound(ringtone, audio);
    channel.enableVibration(true);
    channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
    channel.setShowBadge(false);
    manager.createNotificationChannel(channel);
  }

  static Status status(Context context) {
    Status status = new Status();
    status.supported = Build.VERSION.SDK_INT >= 24;
    NotificationManager manager = (NotificationManager) context.getSystemService(NOTIFICATION_SERVICE);
    status.notifications = NotificationManagerCompat.from(context).areNotificationsEnabled();
    if (!status.supported) { status.channel = false; status.fullScreen = false; return status; }
    if (Build.VERSION.SDK_INT < 26) {
      // Android 7 has no notification channels and uses a package-private call activity.
      status.channel = true; status.fullScreen = true;
    } else if (manager != null) {
      ensureChannel(context);
      NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ID);
      status.channel = channel != null && channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
      status.fullScreen = Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent();
    } else { status.channel = false; status.fullScreen = false; }
    return status;
  }

  static void openSettings(Context context) {
    try {
      Intent intent;
      if (Build.VERSION.SDK_INT >= 34 && !status(context).fullScreen) {
        intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + context.getPackageName()));
      } else {
        intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      context.startActivity(intent);
    } catch (Exception ignored) {
      // Some OEMs hide notification/full-screen settings; do not fail the call path.
    }
  }

  /** Replaces only LastCall's previous managed CallKeep phone account during the upgrade. */
  static boolean prepareAccount(Context context) {
    if (Build.VERSION.SDK_INT < 26) return false;
    TelecomManager telecom = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
    if (telecom == null) return false;
    PhoneAccountHandle handle = accountHandle(context);
    try {
      PhoneAccount account = telecom.getPhoneAccount(handle);
      if (account == null || (account.getCapabilities() & PhoneAccount.CAPABILITY_SELF_MANAGED) == 0) telecom.unregisterPhoneAccount(handle);
    } catch (SecurityException error) {
      // Reading even our own account can need a phone-number permission on newer Android.
      try { telecom.unregisterPhoneAccount(handle); } catch (Exception ignored) {}
    }
    return true;
  }

  private static PhoneAccountHandle accountHandle(Context context) {
    ComponentName component = new ComponentName(context, VoiceConnectionService.class);
    ApplicationInfo info = context.getApplicationInfo();
    int label = info.labelRes;
    String name = label == 0
      ? (info.nonLocalizedLabel == null ? "LastCall" : info.nonLocalizedLabel.toString())
      : context.getString(label);
    return new PhoneAccountHandle(component, name);
  }

  private Notification build(Entry entry) {
    PendingIntent open = activityIntent(entry, ACTION_INCOMING, 1);
    PendingIntent answer = activityIntent(entry, ACTION_ANSWER, 2);
    PendingIntent decline = activityIntent(entry, ACTION_DECLINE, 3);
    NotificationCompat.Builder builder = Build.VERSION.SDK_INT >= 26
      ? new NotificationCompat.Builder(this, CHANNEL_ID)
      : new NotificationCompat.Builder(this);
    builder.setSmallIcon(getApplicationInfo().icon)
      .setContentTitle("LastCall")
      .setContentText("Входящий звонок · " + entry.name)
      .setWhen(entry.startedAt)
      .setShowWhen(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setContentIntent(open)
      .setFullScreenIntent(open, true);
    if (Build.VERSION.SDK_INT >= 31) {
      Person caller = new Person.Builder().setName(entry.name).setImportant(true).build();
      builder.setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer));
      builder.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
    } else {
      builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Отклонить", decline)
        .addAction(android.R.drawable.ic_menu_call, "Принять", answer);
    }
    return builder.build();
  }

  private PendingIntent activityIntent(Entry entry, String action, int kind) {
    Intent intent = new Intent(this, LastCallCallActivity.class).setAction(action)
      .putExtra(EXTRA_UUID, entry.uuid).putExtra(EXTRA_NAME, entry.name)
      .putExtra(EXTRA_VIDEO, entry.video).putExtra(EXTRA_NONCE, entry.nonce)
      .putExtra(EXTRA_EXPIRES, entry.expiresAt);
    int request = entry.uuid.hashCode() * 31 + kind;
    return PendingIntent.getActivity(this, request, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    Entry entry = active;
    if (entry == null) { stopSelf(startId); return START_NOT_STICKY; }
    bound = entry;
    try {
      Notification notification = build(entry);
      if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
      else startForeground(NOTIFICATION_ID, notification);
    } catch (Exception error) {
      synchronized (LastCallCallUiService.class) { stopLocked(this, entry.uuid); }
    }
    return START_NOT_STICKY;
  }

  @Override public void onDestroy() {
    boolean owns, newerEntry;
    synchronized (LastCallCallUiService.class) {
      // An old instance must never clear a newer entry, notification or activity.
      owns = bound != null && active == bound;
      newerEntry = active != null && active != bound;
      if (owns) {
        if (bound.expiry != null) handler.removeCallbacks(bound.expiry);
        active = null;
        finishScreen(bound.uuid);
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(NOTIFICATION_ID);
      }
      bound = null;
    }
    if (!newerEntry) {
      if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
    }
    super.onDestroy();
  }

  @Override public IBinder onBind(Intent intent) { return null; }
}
