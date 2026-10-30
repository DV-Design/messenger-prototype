package dev.messenger.prototype.calls;
import java.util.*;
import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.*;
import com.facebook.react.uimanager.ViewManager;
public final class LastCallAudioPackage implements ReactPackage {
  @Override public List<NativeModule> createNativeModules(ReactApplicationContext context) { return Collections.singletonList(new LastCallAudioModule(context)); }
  @Override public List<ViewManager> createViewManagers(ReactApplicationContext context) { return Collections.emptyList(); }
}
