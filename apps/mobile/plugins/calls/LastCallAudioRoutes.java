package dev.messenger.prototype.calls;

import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import java.util.ArrayList;
import java.util.List;

/** One call-scoped owner for WebRTC communication routing, including outgoing calls without Telecom. */
final class LastCallAudioRoutes {
  private static final Handler main = new Handler(Looper.getMainLooper());
  private static AudioManager audio;
  private static String owner;
  private static boolean ownsMode, ownsSelection, ownsSco, changedSpeaker, previousSpeaker, lastSpeaker;
  private static AudioDeviceCallback devices;
  private static Object communicationListener;
  private static Context legacyContext;
  private static BroadcastReceiver scoEvents;
  private static boolean scoConnected;

  private static String canonical(String id) {
    if (id == null) return "";
    String value = id.replace("-", "");
    return value.matches("[a-f0-9]{32}") ? value : "";
  }
  private static boolean matches(String id) { return owner != null && owner.equals(canonical(id)); }

  static void begin(Context context, String id) {
    if (matches(id)) return;
    if (owner != null) end(owner);
    String next = canonical(id); if (next.isEmpty()) return;
    audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    if (audio == null) return;
    owner = next; previousSpeaker = audio.isSpeakerphoneOn();
    // MODE_NORMAL below removes this process's own mode request; Android retains other clients' requests.
    try { audio.setMode(AudioManager.MODE_IN_COMMUNICATION); ownsMode = true; } catch (RuntimeException ignored) {}
    devices = new AudioDeviceCallback() {
      @Override public void onAudioDevicesAdded(AudioDeviceInfo[] value) { changed(); }
      @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] value) { changed(); }
    };
    audio.registerAudioDeviceCallback(devices, main);
    if (Build.VERSION.SDK_INT >= 31) communicationListener = Modern.listen(audio);
    else {
      legacyContext = context.getApplicationContext();
      scoEvents = new BroadcastReceiver() {
        @Override public void onReceive(Context source, Intent event) {
          if (!matches(next)) return;
          scoConnected = event.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1) == AudioManager.SCO_AUDIO_STATE_CONNECTED;
          changed();
        }
      };
      Intent sticky = legacyContext.registerReceiver(scoEvents, new IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED), null, main);
      scoConnected = sticky != null && sticky.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1) == AudioManager.SCO_AUDIO_STATE_CONNECTED;
    }
    changed();
  }

  static void end(String id) {
    if (Looper.myLooper() != Looper.getMainLooper()) { main.post(() -> end(id)); return; }
    if (!matches(id)) return; // A stale service/action must not release the next call's routing.
    AudioManager manager = audio;
    owner = null;
    try { if (legacyContext != null && scoEvents != null) legacyContext.unregisterReceiver(scoEvents); } catch (RuntimeException ignored) {}
    if (manager != null) {
      try { if (devices != null) manager.unregisterAudioDeviceCallback(devices); } catch (RuntimeException ignored) {}
      if (Build.VERSION.SDK_INT >= 31) {
        try { Modern.unlisten(manager, communicationListener); if (ownsSelection) manager.clearCommunicationDevice(); } catch (RuntimeException ignored) {}
      } else {
        try { if (ownsSco) manager.stopBluetoothSco(); } catch (RuntimeException ignored) {}
        try { if (changedSpeaker && manager.isSpeakerphoneOn() == lastSpeaker) manager.setSpeakerphoneOn(previousSpeaker); } catch (RuntimeException ignored) {}
      }
      try { if (ownsMode) manager.setMode(AudioManager.MODE_NORMAL); } catch (RuntimeException ignored) {}
    }
    audio = null; devices = null; communicationListener = null;
    legacyContext = null; scoEvents = null; scoConnected = false;
    ownsMode = ownsSelection = ownsSco = changedSpeaker = false;
    LastCallAudioModule.dispatchRoutes(snapshot(id));
  }

  private static String kind(AudioDeviceInfo device) {
    switch (device.getType()) {
      case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: return "earpiece";
      case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return "speaker";
      case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
      case AudioDeviceInfo.TYPE_BLE_HEADSET:
      case AudioDeviceInfo.TYPE_BLE_SPEAKER:
      case AudioDeviceInfo.TYPE_HEARING_AID: return "bluetooth";
      case AudioDeviceInfo.TYPE_WIRED_HEADSET:
      case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
      case AudioDeviceInfo.TYPE_USB_HEADSET:
      case AudioDeviceInfo.TYPE_USB_DEVICE: return "wired";
      default: return null;
    }
  }
  private static List<AudioDeviceInfo> available() {
    List<AudioDeviceInfo> result = new ArrayList<>();
    if (audio == null) return result;
    if (Build.VERSION.SDK_INT >= 31) result.addAll(audio.getAvailableCommunicationDevices());
    else for (AudioDeviceInfo device : audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) result.add(device);
    return result;
  }
  static WritableMap snapshot(String id) {
    WritableMap result = Arguments.createMap(); WritableArray routes = Arguments.createArray();
    result.putString("callId", canonical(id)); result.putBoolean("active", matches(id));
    if (matches(id)) {
      AudioDeviceInfo selected = Build.VERSION.SDK_INT >= 31 ? audio.getCommunicationDevice() : null;
      List<AudioDeviceInfo> list = available();
      boolean wired = list.stream().anyMatch(device -> "wired".equals(kind(device)));
      java.util.Set<String> legacyKinds = new java.util.HashSet<>();
      for (AudioDeviceInfo device : list) {
        String type = kind(device); if (type == null) continue;
        // Pre-31 routing has no per-device selector and cannot bypass a plugged-in wired headset.
        if (Build.VERSION.SDK_INT < 31 && ((wired && "earpiece".equals(type)) || !legacyKinds.add(type))) continue;
        // Legacy A2DP outputs are deliberately absent: only call-capable SCO devices can be selected.
        boolean chosen = selected != null && selected.getId() == device.getId();
        if (Build.VERSION.SDK_INT < 31) chosen = type.equals(scoConnected && audio.isBluetoothScoOn() ? "bluetooth" : audio.isSpeakerphoneOn() ? "speaker" : wired ? "wired" : "earpiece");
        WritableMap route = Arguments.createMap(); route.putString("id", Integer.toString(device.getId()));
        route.putString("kind", type); route.putBoolean("selected", chosen); routes.pushMap(route);
      }
    }
    result.putArray("routes", routes); return result;
  }
  static WritableMap select(String id, String deviceId) {
    if (!matches(id)) throw new IllegalStateException("Call audio is no longer active");
    AudioDeviceInfo target = null;
    for (AudioDeviceInfo device : available()) if (Integer.toString(device.getId()).equals(deviceId) && kind(device) != null) { target = device; break; }
    if (target == null) throw new IllegalStateException("Audio device disconnected");
    if (Build.VERSION.SDK_INT >= 31) {
      if (!audio.setCommunicationDevice(target)) throw new IllegalStateException("Android declined audio route");
      ownsSelection = true;
    } else {
      String type = kind(target);
      if ("bluetooth".equals(type)) {
        if (!audio.isBluetoothScoOn()) { audio.startBluetoothSco(); ownsSco = true; }
        audio.setBluetoothScoOn(true);
      } else if (audio.isBluetoothScoOn() || ownsSco) { audio.setBluetoothScoOn(false); audio.stopBluetoothSco(); ownsSco = false; }
      lastSpeaker = "speaker".equals(type); changedSpeaker = true; audio.setSpeakerphoneOn(lastSpeaker);
    }
    // Selection is asynchronous: return observed state, never mark the requested item selected here.
    return snapshot(id);
  }
  private static void changed() {
    String id = owner;
    if (id != null) LastCallAudioModule.dispatchRoutes(snapshot(id));
  }
  private static final class Modern {
    static Object listen(AudioManager manager) {
      AudioManager.OnCommunicationDeviceChangedListener listener = device -> changed();
      manager.addOnCommunicationDeviceChangedListener(command -> main.post(command), listener); return listener;
    }
    static void unlisten(AudioManager manager, Object listener) {
      if (listener != null) manager.removeOnCommunicationDeviceChangedListener((AudioManager.OnCommunicationDeviceChangedListener) listener);
    }
  }
}
