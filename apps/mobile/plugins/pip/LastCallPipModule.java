package dev.messenger.prototype.pip;

import java.lang.ref.WeakReference;
import com.facebook.react.bridge.*;
import com.facebook.react.modules.core.DeviceEventManagerModule;

public final class LastCallPipModule extends ReactContextBaseJavaModule {
  private static WeakReference<LastCallPipModule> current = new WeakReference<>(null);
  LastCallPipModule(ReactApplicationContext context) { super(context); current = new WeakReference<>(this); }
  @Override public String getName() { return "LastCallPip"; }
  @ReactMethod public void addListener(String name) {}
  @ReactMethod public void removeListeners(Integer count) {}
  static void emit(WritableMap value) {
    LastCallPipModule module = current.get();
    if (module != null && module.getReactApplicationContext().hasActiveReactInstance()) module.getReactApplicationContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("LastCallPipChanged", value);
  }
  @ReactMethod public void configure(String id, boolean enabled, double width, double height, Promise promise) {
    UiThreadUtil.runOnUiThread(() -> { try { LastCallPip.configure(getReactApplicationContext(), getCurrentActivity(), id, enabled, width, height); promise.resolve(LastCallPip.snapshot(getReactApplicationContext(), false)); } catch (RuntimeException error) { promise.reject("CALL_PIP", "Android could not configure video picture-in-picture", error); } });
  }
  @ReactMethod public void enter(String id, Promise promise) {
    UiThreadUtil.runOnUiThread(() -> { try { LastCallPip.enter(id); promise.resolve(LastCallPip.snapshot(getReactApplicationContext(), false)); } catch (RuntimeException error) { promise.reject("CALL_PIP", "Android could not open video picture-in-picture", error); } });
  }
  @ReactMethod public void clear(String id) { UiThreadUtil.runOnUiThread(() -> LastCallPip.clear(id)); }
  @ReactMethod public void getState(Promise promise) {
    UiThreadUtil.runOnUiThread(() -> promise.resolve(LastCallPip.snapshot(getReactApplicationContext(), false)));
  }
}
