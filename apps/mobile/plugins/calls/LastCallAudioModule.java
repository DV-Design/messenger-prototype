package dev.messenger.prototype.calls;
import android.content.Intent;
import android.content.pm.PackageManager;
import com.facebook.react.bridge.*;
public final class LastCallAudioModule extends ReactContextBaseJavaModule {
  LastCallAudioModule(ReactApplicationContext context) { super(context); }
  @Override public String getName() { return "LastCallAudio"; }
  @ReactMethod public void holdWakeHost(String id, Promise result) { LastCallWakeLease.hold(getReactApplicationContext(), id, result); }
  @ReactMethod public void releaseWakeHost(String id) { LastCallWakeLease.release(id); }
  @ReactMethod public void holdHost(String id) { LastCallHostLease.hold(getReactApplicationContext(), id); }
  @ReactMethod public void releaseHost(String id) { LastCallHostLease.release(id); }
  @ReactMethod public void start(String id, boolean video, Promise promise) {
    if (getReactApplicationContext().checkSelfPermission("android.permission.RECORD_AUDIO") != PackageManager.PERMISSION_GRANTED) { promise.reject("CALL_MIC_DENIED", "Microphone permission must be granted in foreground first"); return; }
    if (video && getReactApplicationContext().checkSelfPermission("android.permission.CAMERA") != PackageManager.PERMISSION_GRANTED) { promise.reject("CALL_CAMERA_DENIED", "Camera permission must be granted in foreground first"); return; }
    LastCallAudioService.begin(getReactApplicationContext(), id, video, promise);
  }
  @ReactMethod public void stop(String id) { LastCallAudioService.end(getReactApplicationContext(), id); }
}
