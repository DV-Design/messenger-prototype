package dev.messenger.prototype.calls;

import android.app.Activity;
import dev.messenger.prototype.R;
import android.app.ActivityOptions;
import android.app.KeyguardManager;
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
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
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
  private static volatile WeakReference<LastCallCallUiService> running = new WeakReference<>(null);
  private Entry bound;
  private PowerManager.WakeLock screenLock;
  private Ringtone ringtone;
  private Vibrator vibrator;

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
    boolean specialAccessRequired;
    /** A lower channel importance drops both the full-screen launch and the ringtone. */
    boolean alerting;
    boolean lockscreen;
    int importance;
    String oem = "";
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
      LastCallCpuWake.release(ringHold(previous.uuid));
    }
    byte[] secret = new byte[24]; RANDOM.nextBytes(secret);
    Entry entry = new Entry(context, uuid, name == null || name.isEmpty() ? "LastCall" : name, video, hex(secret), now, deadline);
    entry.expiry = () -> expire(entry);
    active = entry;
    handler.postDelayed(entry.expiry, deadline - now);
    LastCallCpuWake.hold(context, ringHold(uuid), deadline - now);
    LastCallCallTrace.add(context, "ui-begin");
    ensureChannel(context);
    try {
      Intent intent = new Intent(context, LastCallCallUiService.class).setAction(ACTION_INCOMING);
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent); else context.startService(intent);
      return true;
    } catch (Exception error) {
      handler.removeCallbacks(entry.expiry);
      if (active == entry) active = null;
      LastCallCpuWake.release(ringHold(uuid));
      LastCallCallTrace.add(context, "ui-start-failed");
      return false;
    }
  }

  private static void expire(Entry entry) {
    synchronized (LastCallCallUiService.class) {
      // A stale timer from an old entry must never touch the current call.
      if (active != entry) return;
      LastCallCallTrace.add(entry.context, "expired");
      LastCallAudioService.endPending(entry.context, entry.uuid);
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

  static Entry current() { return active; }

  static void expirePendingAudio(String uuid) {
    Entry entry = active;
    if (entry != null && entry.uuid.equals(uuid)) expire(entry);
  }

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
    LastCallCpuWake.release(ringHold(uuid));
    finishScreen(uuid);
    NotificationManager manager = (NotificationManager) context.getSystemService(NOTIFICATION_SERVICE);
    if (manager != null) manager.cancel(NOTIFICATION_ID);
    context.stopService(new Intent(context, LastCallCallUiService.class));
  }

  private static String ringHold(String uuid) { return "ring-" + uuid; }

  /** Answering must stop the fallback alert at once, before media is ready. */
  static void silenceRinging() {
    LastCallCallUiService service = running.get();
    if (service != null) handler.post(service::stopAlert);
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
    NotificationChannel channel = new NotificationChannel(CHANNEL_ID, context.getString(R.string.lastcall_call_incoming_channel), NotificationManager.IMPORTANCE_HIGH);
    channel.setDescription(context.getString(R.string.lastcall_call_incoming_desc));
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
    status.specialAccessRequired = Build.VERSION.SDK_INT >= 34;
    NotificationManager manager = (NotificationManager) context.getSystemService(NOTIFICATION_SERVICE);
    status.notifications = NotificationManagerCompat.from(context).areNotificationsEnabled();
    String maker = (Build.MANUFACTURER + " " + Build.BRAND).toLowerCase(java.util.Locale.ROOT);
    if (maker.contains("vivo") || maker.contains("iqoo")) status.oem = "vivo";
    status.alerting = true; status.lockscreen = true; status.importance = -1;
    if (!status.supported) { status.channel = false; status.fullScreen = false; return status; }
    if (Build.VERSION.SDK_INT < 26) {
      // Android 7 has no notification channels and uses a package-private call activity.
      status.channel = true; status.fullScreen = true;
    } else if (manager != null) {
      ensureChannel(context);
      NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ID);
      status.channel = channel != null && channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
      status.importance = channel == null ? -1 : channel.getImportance();
      status.alerting = channel != null && channel.getImportance() >= NotificationManager.IMPORTANCE_HIGH;
      status.lockscreen = channel != null && channel.getLockscreenVisibility() != Notification.VISIBILITY_SECRET;
      status.fullScreen = Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent();
    } else { status.channel = false; status.fullScreen = false; }
    return status;
  }

  static void openSettings(Context context) {
    try {
      Intent intent;
      Status current = status(context);
      if (Build.VERSION.SDK_INT >= 34 && !current.fullScreen) {
        intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + context.getPackageName()));
      } else if (Build.VERSION.SDK_INT >= 26 && current.notifications && current.channel && (!current.alerting || !current.lockscreen)) {
        openChannelSettings(context);
        return;
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

  static void openChannelSettings(Context context) {
    String pkg = context.getPackageName();
    if (Build.VERSION.SDK_INT >= 26) {
      ensureChannel(context);
      try {
        context.startActivity(new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_APP_PACKAGE, pkg).putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL_ID)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        return;
      } catch (Exception unavailable) { /* Fall through: some OEMs hide the per-channel screen. */ }
      try {
        context.startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_APP_PACKAGE, pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        return;
      } catch (Exception unavailable) { /* Fall through to the app details screen. */ }
    }
    openAppDetails(context);
  }

  private static void openAppDetails(Context context) {
    try {
      context.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.getPackageName()))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    } catch (Exception ignored) {
      // No settings screen is available; the call path itself is unaffected.
    }
  }

  /** vivo's per-app permission screen is undocumented, so every step falls back to the next. */
  static void openOemSettings(Context context) {
    String pkg = context.getPackageName();
    Intent[] attempts = {
      new Intent("secure.intent.action.softPermissionDetail").putExtra("packagename", pkg),
      new Intent().setClassName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.SoftPermissionDetailActivity").putExtra("packagename", pkg),
    };
    for (Intent attempt : attempts) {
      try { context.startActivity(attempt.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return; }
      catch (Exception unavailable) { /* Try the next screen. */ }
    }
    openAppDetails(context);
  }

  /** Launching special settings does not grant access; JS waits for leave/return and reads status. */
  static boolean openFullScreenSettings(Context context) {
    if (Build.VERSION.SDK_INT < 34) return false;
    try {
      Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
        Uri.parse("package:" + context.getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      context.startActivity(intent);
      return true;
    } catch (Exception unavailable) { return false; }
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
      .setContentText(getString(R.string.lastcall_call_incoming_text, entry.name))
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
      builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, getString(R.string.lastcall_decline), decline)
        .addAction(android.R.drawable.ic_menu_call, getString(R.string.lastcall_answer), answer);
    }
    return builder.build();
  }

  private PendingIntent activityIntent(Entry entry, String action, int kind) {
    Intent intent = new Intent(this, LastCallCallActivity.class).setAction(action)
      .putExtra(EXTRA_UUID, entry.uuid).putExtra(EXTRA_NAME, entry.name)
      .putExtra(EXTRA_VIDEO, entry.video).putExtra(EXTRA_NONCE, entry.nonce)
      .putExtra(EXTRA_EXPIRES, entry.expiresAt);
    int request = entry.uuid.hashCode() * 31 + kind;
    int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    if (Build.VERSION.SDK_INT >= 34) {
      // Delegate BAL only for this private, immutable, live UUID/nonce/expiry-bound call activity.
      // ALLOW_IF_VISIBLE would suppress a legitimate incoming call while the phone is locked.
      ActivityOptions options = ActivityOptions.makeBasic();
      options.setPendingIntentCreatorBackgroundActivityStartMode(Build.VERSION.SDK_INT >= 36
        ? ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_ALWAYS
        : ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
      return PendingIntent.getActivity(this, request, intent, flags, options.toBundle());
    }
    return PendingIntent.getActivity(this, request, intent, flags);
  }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    Entry entry = active;
    if (entry == null) { stopSelf(startId); return START_NOT_STICKY; }
    bound = entry;
    running = new WeakReference<>(this);
    try {
      Notification notification = build(entry);
      if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
      else startForeground(NOTIFICATION_ID, notification);
      LastCallCallTrace.add(this, "ui-foreground");
      ringFallback();
      // Let the system decide on the full-screen launch first: it treats a screen that is
      // already on differently. Some OEM builds drop that launch and leave only a status icon.
      handler.postDelayed(() -> alertOverLock(entry), 300);
    } catch (Exception error) {
      LastCallCallTrace.add(this, "ui-foreground-failed");
      synchronized (LastCallCallUiService.class) { stopLocked(this, entry.uuid); }
    }
    return START_NOT_STICKY;
  }

  private void alertOverLock(Entry entry) {
    if (active != entry) return;
    PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
    KeyguardManager keyguard = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
    boolean asleep = power != null && !power.isInteractive();
    boolean locked = keyguard != null && keyguard.isKeyguardLocked();
    if (!asleep && !locked) return; // In use: Android's heads-up call notification is the right UI.
    if (asleep && power != null) wakeScreen(power, entry);
    handler.postDelayed(() -> launchIfMissing(entry), 400);
  }

  @SuppressWarnings("deprecation")
  private void wakeScreen(PowerManager power, Entry entry) {
    long remaining = entry.expiresAt - System.currentTimeMillis();
    if (remaining <= 0 || screenLock != null) return;
    try {
      // Deprecated in favour of FLAG_TURN_SCREEN_ON, which needs the Activity this may not get.
      screenLock = power.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE, "LastCall:ring");
      screenLock.setReferenceCounted(false);
      screenLock.acquire(remaining);
      LastCallCallTrace.add(this, "screen-wake");
    } catch (RuntimeException error) { LastCallCallTrace.add(this, "screen-wake-failed"); }
  }

  private void launchIfMissing(Entry entry) {
    if (active != entry) return;
    if (screen.get() != null) return; // The full-screen launch already worked.
    LastCallCallTrace.add(this, "activity-try");
    try { activityIntent(entry, ACTION_INCOMING, 1).send(); }
    catch (PendingIntent.CanceledException | RuntimeException error) { LastCallCallTrace.add(this, "activity-try-failed"); }
  }

  /** The channel's ringtone only plays at high importance, which an OEM or the user can lower. */
  private void ringFallback() {
    if (Build.VERSION.SDK_INT < 26 || ringtone != null || vibrator != null) return;
    NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    NotificationChannel channel = manager == null ? null : manager.getNotificationChannel(CHANNEL_ID);
    if (channel != null && channel.getImportance() >= NotificationManager.IMPORTANCE_HIGH && channel.getSound() != null) return;
    LastCallCallTrace.add(this, "ring-fallback");
    AudioManager audio = (AudioManager) getSystemService(AUDIO_SERVICE);
    int mode = audio == null ? AudioManager.RINGER_MODE_NORMAL : audio.getRingerMode();
    if (mode == AudioManager.RINGER_MODE_SILENT) return;
    try {
      Vibrator device = (Vibrator) getSystemService(VIBRATOR_SERVICE);
      if (device != null && device.hasVibrator()) {
        device.vibrate(VibrationEffect.createWaveform(new long[] { 0, 800, 800 }, 0));
        vibrator = device;
      }
    } catch (RuntimeException ignored) { /* Sound may still work. */ }
    if (mode != AudioManager.RINGER_MODE_NORMAL) return;
    try {
      Ringtone tone = RingtoneManager.getRingtone(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE));
      if (tone == null) return;
      tone.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
      if (Build.VERSION.SDK_INT >= 28) tone.setLooping(true);
      tone.play();
      ringtone = tone;
    } catch (RuntimeException ignored) { /* The visible call UI remains. */ }
  }

  private void stopAlert() {
    try { if (ringtone != null) ringtone.stop(); } catch (RuntimeException ignored) {}
    ringtone = null;
    try { if (vibrator != null) vibrator.cancel(); } catch (RuntimeException ignored) {}
    vibrator = null;
    try { if (screenLock != null && screenLock.isHeld()) screenLock.release(); } catch (RuntimeException ignored) {}
    screenLock = null;
  }

  @Override public void onDestroy() {
    stopAlert();
    if (running.get() == this) running.clear();
    boolean owns, newerEntry;
    synchronized (LastCallCallUiService.class) {
      // An old instance must never clear a newer entry, notification or activity.
      owns = bound != null && active == bound;
      newerEntry = active != null && active != bound;
      if (owns) {
        if (bound.expiry != null) handler.removeCallbacks(bound.expiry);
        LastCallCpuWake.release(ringHold(bound.uuid));
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
