package dev.messenger.prototype.calls;

import android.app.Activity;
import android.app.Application;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import java.lang.ref.WeakReference;

/**
 * An answered call continues in the app, over the lock screen, like Telegram.
 * Only while that call lasts: when it ends the app goes back behind the keyguard.
 */
public final class LastCallLockScreen {
  private static WeakReference<Activity> main = new WeakReference<>(null);
  private static String callId;
  private static boolean installed;

  private LastCallLockScreen() {}

  private static boolean isMain(Activity activity) { return "MainActivity".equals(activity.getClass().getSimpleName()); }

  /** From Application.onCreate: follows MainActivity so a new instance gets the current state. */
  public static synchronized void install(Application application) {
    if (installed) return;
    installed = true;
    application.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
      @Override public void onActivityCreated(Activity activity, Bundle state) { if (isMain(activity)) { main = new WeakReference<>(activity); apply(activity); } }
      @Override public void onActivityStarted(Activity activity) {}
      @Override public void onActivityResumed(Activity activity) { if (isMain(activity)) { main = new WeakReference<>(activity); apply(activity); } }
      @Override public void onActivityPaused(Activity activity) {}
      @Override public void onActivityStopped(Activity activity) {}
      @Override public void onActivitySaveInstanceState(Activity activity, Bundle state) {}
      @Override public void onActivityDestroyed(Activity activity) { if (main.get() == activity) main.clear(); }
    });
  }

  private static synchronized boolean active() { return callId != null; }

  private static void apply(Activity activity) {
    boolean on = active();
    if (Build.VERSION.SDK_INT >= 27) { activity.setShowWhenLocked(on); activity.setTurnScreenOn(on); }
    else if (on) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
    else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
  }

  /**
   * The call answered on the call-only screen is now live: open the app's call view over the
   * lock screen. Started from that visible screen, so Android allows the activity launch.
   */
  static void handOff(Activity from, String id) {
    synchronized (LastCallLockScreen.class) { callId = id; }
    Activity current = main.get();
    if (current != null) current.runOnUiThread(() -> apply(current));
    Intent open = from.getPackageManager().getLaunchIntentForPackage(from.getPackageName());
    if (open == null) return;
    open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    try { from.startActivity(open); LastCallCallTrace.add(from, "app-over-lock"); }
    catch (RuntimeException error) { LastCallCallTrace.add(from, "app-over-lock-failed"); }
  }

  /** The call ended: the app is no longer shown over the keyguard. */
  static void end(String id) {
    synchronized (LastCallLockScreen.class) {
      if (callId == null || (id != null && !callId.equals(id) && !callId.replace("-", "").equals(id.replace("-", "")))) return;
      callId = null;
    }
    Activity current = main.get();
    if (current != null) current.runOnUiThread(() -> apply(current));
  }

  static boolean locked(Context context) {
    KeyguardManager keyguard = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
    return keyguard != null && keyguard.isKeyguardLocked();
  }

  /** Leaving the call view on a locked phone asks for the unlock first, so chats never show over the lock screen. */
  static void requestUnlock(Activity activity, Runnable unlocked) {
    KeyguardManager keyguard = (KeyguardManager) activity.getSystemService(Context.KEYGUARD_SERVICE);
    if (keyguard == null || !keyguard.isKeyguardLocked()) { unlocked.run(); return; }
    if (Build.VERSION.SDK_INT < 26) return;
    keyguard.requestDismissKeyguard(activity, new KeyguardManager.KeyguardDismissCallback() {
      @Override public void onDismissSucceeded() { unlocked.run(); }
    });
  }
}
