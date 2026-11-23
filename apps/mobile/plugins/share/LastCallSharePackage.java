package dev.messenger.prototype.share;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;
import java.util.Collections;
import java.util.List;

public final class LastCallSharePackage implements ReactPackage {
  @Override public List<NativeModule> createNativeModules(ReactApplicationContext context) { return Collections.singletonList(new LastCallShareModule(context)); }
  @Override public List<ViewManager> createViewManagers(ReactApplicationContext context) { return Collections.emptyList(); }
}
