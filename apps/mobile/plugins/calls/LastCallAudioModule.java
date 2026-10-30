package dev.messenger.prototype.calls;
import android.content.pm.PackageManager;
import com.facebook.react.bridge.*;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import java.lang.ref.WeakReference;
public final class LastCallAudioModule extends ReactContextBaseJavaModule {
  private static WeakReference<LastCallAudioModule> active = new WeakReference<>(null);
  LastCallAudioModule(ReactApplicationContext context) { super(context); active = new WeakReference<>(this); }
  @Override public String getName() { return "LastCallAudio"; }
  @Override public void invalidate() {
    if (active.get() == this) active.clear();
    super.invalidate();
  }
  /** Same-process, non-exported bridge from the validated call activity to the existing controller. */
  static void dispatch(String uuid, String action) {
    LastCallAudioModule module = active.get();
    if (module == null || uuid == null || !("answer".equals(action) || "end".equals(action))) return;
    ReactApplicationContext context = module.getReactApplicationContext();
    if (!context.hasActiveReactInstance()) return;
    WritableMap event = Arguments.createMap();
    event.putString("callUUID", uuid);
    event.putString("action", action);
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("LastCallCallAction", event);
  }
  @ReactMethod public void addListener(String eventName) {}
  @ReactMethod public void removeListeners(Integer count) {}
  @ReactMethod public void holdWakeHost(String id, double durationMs, Promise result) { LastCallWakeLease.hold(getReactApplicationContext(), id, durationMs, result); }
  @ReactMethod public void releaseWakeHost(String id) { LastCallWakeLease.release(id); }
  @ReactMethod public void holdHost(String id) { LastCallHostLease.hold(getReactApplicationContext(), id); }
  @ReactMethod public void releaseHost(String id) { LastCallHostLease.release(id); }
  @ReactMethod public void prepareCallAccounts(Promise result) {
    try { result.resolve(LastCallCallUiService.prepareAccount(getReactApplicationContext())); }
    catch (Exception error) { result.reject("CALL_ACCOUNT_UNAVAILABLE", "LastCall phone account could not be prepared"); }
  }
  @ReactMethod public void showCallUi(String uuid, String name, boolean video, double expiresAt, Promise result) {
    boolean shown = LastCallCallUiService.begin(getReactApplicationContext(), uuid, name, video, (long) expiresAt);
    result.resolve(shown);
  }
  @ReactMethod public void dismissCallUi(String uuid) { LastCallCallUiService.stop(getReactApplicationContext(), uuid); }
  @ReactMethod public void startCallSetup(String id, double expiresAt) {
    try { LastCallCallSetupService.begin(getReactApplicationContext(), id, (long) expiresAt); } catch (Exception ignored) {}
  }
  @ReactMethod public void stopCallSetup(String id) { LastCallCallSetupService.end(getReactApplicationContext(), id); }
  @ReactMethod public void callUiStatus(Promise result) {
    LastCallCallUiService.Status status = LastCallCallUiService.status(getReactApplicationContext());
    WritableMap map = Arguments.createMap();
    map.putBoolean("supported", status.supported);
    map.putBoolean("notifications", status.notifications);
    map.putBoolean("channel", status.channel);
    map.putBoolean("fullScreen", status.fullScreen);
    result.resolve(map);
  }
  @ReactMethod public void openCallUiSettings() { LastCallCallUiService.openSettings(getReactApplicationContext()); }
  @ReactMethod public void start(String id, boolean video, Promise promise) {
    if (getReactApplicationContext().checkSelfPermission("android.permission.RECORD_AUDIO") != PackageManager.PERMISSION_GRANTED) { promise.reject("CALL_MIC_DENIED", "Microphone permission must be granted in foreground first"); return; }
    if (video && getReactApplicationContext().checkSelfPermission("android.permission.CAMERA") != PackageManager.PERMISSION_GRANTED) { promise.reject("CALL_CAMERA_DENIED", "Camera permission must be granted in foreground first"); return; }
    LastCallAudioService.begin(getReactApplicationContext(), id, video, promise);
  }
  @ReactMethod public void stop(String id) { LastCallAudioService.end(getReactApplicationContext(), id); }
}
