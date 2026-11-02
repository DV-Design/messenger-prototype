package dev.messenger.prototype.pip;

import android.app.Activity;
import android.app.AppOpsManager;
import android.app.KeyguardManager;
import android.app.PendingIntent;
import android.app.PictureInPictureParams;
import android.app.RemoteAction;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Rect;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Rational;
import java.lang.ref.WeakReference;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;

/** PiP changes presentation only: the existing answered-call service owns camera and microphone. */
public final class LastCallPip {
  static final String CLOSE = "dev.messenger.prototype.pip.CLOSE";
  private static final Handler main = new Handler(Looper.getMainLooper());
  private static WeakReference<Activity> host = new WeakReference<>(null);
  private static Context app;
  private static String owner;
  private static boolean enabled, transitioning, resumed, hadPip, closed;
  private static long generation;
  private static double ratio = 16.0 / 9.0;

  private static String canonical(String id) { return id != null && id.matches("[a-f0-9]{32}") ? id : ""; }
  private static boolean matches(String id) { return owner != null && owner.equals(canonical(id)); }
  private static boolean supported(Context context) { return Build.VERSION.SDK_INT >= 26 && context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE); }
  private static boolean allowed(Context context) {
    if (!supported(context)) return false;
    try {
      AppOpsManager ops = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
      return ops != null && ops.checkOpNoThrow(AppOpsManager.OPSTR_PICTURE_IN_PICTURE, android.os.Process.myUid(), context.getPackageName()) == AppOpsManager.MODE_ALLOWED;
    } catch (RuntimeException ignored) { return false; }
  }
  private static boolean pinned(Activity activity) { return Build.VERSION.SDK_INT >= 26 && activity != null && activity.isInPictureInPictureMode(); }
  private static boolean current(Activity activity) { return activity != null && activity == host.get(); }
  private static boolean usable(Activity activity) { return activity != null && !activity.isFinishing() && !activity.isDestroyed(); }
  static WritableMap snapshot(Context context, boolean dismissed) {
    WritableMap value = Arguments.createMap();
    value.putString("callId", owner == null ? "" : owner);
    value.putBoolean("supported", supported(context)); value.putBoolean("allowed", allowed(context));
    value.putBoolean("active", owner != null && pinned(host.get()));
    value.putBoolean("enabled", owner != null && enabled);
    value.putBoolean("transitioning", owner != null && transitioning);
    value.putBoolean("closed", dismissed);
    return value;
  }
  private static void emit(boolean dismissed) { if (app != null) LastCallPipModule.emit(snapshot(app, dismissed)); }

  static void configure(Context context, Activity candidate, String id, boolean arm, double width, double height) {
    String next = canonical(id); if (next.isEmpty()) throw new IllegalArgumentException("Invalid call id");
    app = context.getApplicationContext();
    if (candidate != null && candidate.getClass().getName().equals(context.getPackageName() + ".MainActivity")) host = new WeakReference<>(candidate);
    if (!next.equals(owner)) { owner = next; generation++; hadPip = pinned(host.get()); closed = false; transitioning = false; }
    if (enabled != arm) { enabled = arm; generation++; }
    if (Double.isFinite(width) && Double.isFinite(height) && width > 0 && height > 0) ratio = Math.max(0.42, Math.min(2.39, width / height));
    apply(); emit(false);
  }
  private static PictureInPictureParams params(Activity activity) {
    PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder().setAspectRatio(new Rational((int) Math.round(ratio * 1000), 1000));
    Rect rect = new Rect();
    if (activity.getWindow().getDecorView().getGlobalVisibleRect(rect) && !rect.isEmpty()) builder.setSourceRectHint(rect);
    if (Build.VERSION.SDK_INT >= 31) builder.setAutoEnterEnabled(enabled && owner != null && allowed(activity)).setSeamlessResizeEnabled(true);
    if (Build.VERSION.SDK_INT >= 33 && owner != null) {
      Intent close = new Intent(activity, LastCallPipCloseReceiver.class).setAction(CLOSE).setData(Uri.parse("lastcall-pip://close/" + owner)).putExtra("callId", owner);
      PendingIntent action = PendingIntent.getBroadcast(activity, 861, close, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      builder.setCloseAction(new RemoteAction(Icon.createWithResource(activity, android.R.drawable.ic_menu_close_clear_cancel), "Завершить звонок", "Завершить видеозвонок", action));
    }
    return builder.build();
  }
  private static void apply() {
    Activity activity = host.get();
    if (usable(activity) && supported(activity)) {
      try { activity.setPictureInPictureParams(params(activity)); } catch (RuntimeException ignored) { /* Report observed permission/mode; never claim entry from a configuration request. */ }
    }
  }
  static void enter(String id) {
    Activity activity = host.get();
    if (!matches(id) || !enabled || closed) throw new IllegalStateException("Video call is no longer active");
    if (!usable(activity) || !allowed(activity)) throw new IllegalStateException("Picture-in-picture is not available");
    if (!pinned(activity) && !activity.enterPictureInPictureMode(params(activity))) throw new IllegalStateException("Android declined picture-in-picture");
  }
  static void clear(String id) {
    if (!matches(id)) return;
    Activity activity = host.get(); boolean finishPinned = pinned(activity);
    owner = null; enabled = transitioning = hadPip = closed = false; generation++;
    apply(); emit(false);
    // There is no public exit-PiP-to-background API. Never finish the regular foreground activity.
    if (finishPinned && usable(activity)) activity.finish();
  }
  static void close(String id) {
    // The PiP window may already be leaving when the immutable close intent lands.
    if (!matches(id) || closed) return;
    userClosed(host.get());
  }
  private static void userClosed(Activity activity) {
    if (owner == null || closed) return;
    closed = true; enabled = transitioning = false; generation++;
    apply(); emit(true); // JS ends only its matching call, then clear releases the native owner.
    if (pinned(activity) && usable(activity)) activity.finish();
  }
  public static void onResume(Activity activity) {
    host = new WeakReference<>(activity); app = activity.getApplicationContext();
    resumed = true; hadPip = pinned(activity); transitioning = false;
    apply(); emit(false);
  }
  public static void onPause(Activity activity) { if (current(activity)) resumed = false; }
  public static void onUserLeaveHint(Activity activity) {
    if (Build.VERSION.SDK_INT >= 26 && Build.VERSION.SDK_INT < 31 && current(activity) && enabled && owner != null) {
      try { enter(owner); } catch (RuntimeException ignored) { emit(false); }
    }
  }
  public static void onModeChanged(Activity activity, boolean active) {
    if (!current(activity)) return;
    if (active) hadPip = true;
    transitioning = false; emit(false);
  }
  public static void onTransition(Activity activity, boolean entering) {
    if (!current(activity)) return;
    transitioning = owner != null && enabled && entering; emit(false);
  }
  public static void onStop(Activity activity) {
    if (!current(activity) || owner == null || !hadPip || closed) return;
    String id = owner; long token = generation;
    // Old Android lacks an explicit close action. A stopped visible PiP is dismissed;
    // pause alone, a normal full-screen return, configuration changes and screen lock are not.
    main.postDelayed(() -> {
      if (!current(activity) || !matches(id) || token != generation || resumed || closed || activity.isChangingConfigurations()) return;
      KeyguardManager keyguard = (KeyguardManager) activity.getSystemService(Context.KEYGUARD_SERVICE);
      PowerManager power = (PowerManager) activity.getSystemService(Context.POWER_SERVICE);
      if (power != null && power.isInteractive() && (keyguard == null || !keyguard.isKeyguardLocked())) userClosed(activity);
    }, 350);
  }
  public static void onDestroy(Activity activity) {
    if (!current(activity)) return;
    host = new WeakReference<>(null); resumed = false; transitioning = false;
  }
}
