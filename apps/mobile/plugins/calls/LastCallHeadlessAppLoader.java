package dev.messenger.prototype.calls;
import android.content.Context;
import android.os.*;
import com.facebook.proguard.annotations.DoNotStrip;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.jstasks.HeadlessJsTaskContext;
import com.facebook.react.jstasks.HeadlessJsTaskEventListener;
import expo.modules.apploader.HeadlessAppLoader;
import expo.modules.adapters.react.apploader.RNHeadlessAppLoader;
import expo.modules.core.interfaces.Consumer;
import java.lang.ref.WeakReference;
import java.util.*;

/** SDK58's documented manifest app-loader extension; delegate all actual loading/ownership. */
@DoNotStrip
public final class LastCallHeadlessAppLoader implements HeadlessAppLoader {
  private final HeadlessAppLoader delegate = new RNHeadlessAppLoader();
  private final Set<String> pending = new HashSet<>();
  private final Handler handler = new Handler(Looper.getMainLooper());
  private int retryCount;
  private final Runnable retry = this::drainPending;
  private WeakReference<HeadlessJsTaskContext> watched = new WeakReference<>(null);
  private final HeadlessJsTaskEventListener taskEvents = new HeadlessJsTaskEventListener() {
    @Override public void onHeadlessJsTaskStart(int taskId) {}
    @Override public void onHeadlessJsTaskFinish(int taskId) { handler.post(LastCallHeadlessAppLoader.this::drainPending); }
  };
  private static volatile LastCallHeadlessAppLoader instance;
  private static WeakReference<ReactContext> context = new WeakReference<>(null);
  @DoNotStrip public LastCallHeadlessAppLoader() { instance = this; }
  static void setContext(ReactContext value) { context = new WeakReference<>(value); }
  public void loadApp(Context value, Params params, Runnable alreadyRunning, Consumer<Boolean> callback) { delegate.loadApp(value, params, alreadyRunning, callback); }
  public boolean isRunning(String key) { return delegate.isRunning(key); }
  public boolean invalidateApp(String key) {
    handler.post(() -> { pending.add(key); retryCount = 0; drainPending(); });
    return true;
  }
  static void drain() { if (instance != null) instance.handler.post(instance::drainPending); }
  private void watch(HeadlessJsTaskContext tasks) {
    HeadlessJsTaskContext previous = watched.get(); if (previous == tasks) return;
    if (previous != null) previous.removeTaskEventListener(taskEvents);
    watched = new WeakReference<>(tasks);
    if (tasks != null) tasks.addTaskEventListener(taskEvents);
  }
  private void drainPending() {
    handler.removeCallbacks(retry);
    if (pending.isEmpty()) { watch(null); retryCount = 0; return; }
    if (LastCallHostLease.isHeld() || LastCallWakeLease.isHeld()) return;
    ReactContext value = context.get();
    if (value != null && value.hasActiveReactInstance()) {
      HeadlessJsTaskContext tasks = HeadlessJsTaskContext.getInstance(value);
      if (tasks.hasActiveTasks()) {
        watch(tasks);
        // Poll only for a bounded compatibility window; task-finish events still drain later.
        if (retryCount++ < 12) handler.postDelayed(retry, 1000);
        return;
      }
    }
    watch(null); retryCount = 0;
    for (String key : new HashSet<>(pending)) delegate.invalidateApp(key);
    pending.clear();
  }
}
