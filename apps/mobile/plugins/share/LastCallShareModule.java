package dev.messenger.prototype.share;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * "Share → LastCall": reads what another app handed over (text, one or several files) and copies the
 * files into this app's own cache folder, off the main thread. Any provider that refuses, lies about
 * a file or fails half-way only drops that file; it never takes the app down.
 */
public final class LastCallShareModule extends ReactContextBaseJavaModule {
  private static final String TAKEN = "lastcallShareTaken";
  private static final int MAX_FILES = 10;
  private static final int MAX_TEXT = 16000;
  private static final long MAX_BYTES = 1024L * 1024 * 1024;
  private final ReactApplicationContext context;
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private Intent pending;
  private final BaseActivityEventListener listener = new BaseActivityEventListener() {
    @Override public void onNewIntent(Intent intent) {
      if (!isShare(intent)) return;
      synchronized (LastCallShareModule.this) { pending = intent; }
      if (context.hasActiveReactInstance()) context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("LastCallShareReceived", null);
    }
  };
  /** A share that launched or resumed the activity is announced once JavaScript can hear it. */
  private final LifecycleEventListener lifecycle = new LifecycleEventListener() {
    @Override public void onHostResume() {
      Activity activity = getCurrentActivity();
      if (activity == null || !isShare(activity.getIntent())) return;
      if (context.hasActiveReactInstance()) context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("LastCallShareReceived", null);
    }
    @Override public void onHostPause() {}
    @Override public void onHostDestroy() {}
  };
  public LastCallShareModule(ReactApplicationContext context) { super(context); this.context = context; context.addActivityEventListener(listener); context.addLifecycleEventListener(lifecycle); }
  @Override public String getName() { return "LastCallShare"; }
  @ReactMethod public void addListener(String eventName) {}
  @ReactMethod public void removeListeners(double count) {}
  private static boolean isShare(Intent intent) {
    // Reopening the app from Recents replays the launch intent: that is not a new share.
    return intent != null && (Intent.ACTION_SEND.equals(intent.getAction()) || Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) && !intent.getBooleanExtra(TAKEN, false)
      && (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0;
  }
  /** The newest share not handed to JS yet, or null. Each share is handed over once. */
  @ReactMethod public void take(Promise promise) {
    Intent intent;
    synchronized (this) {
      intent = pending; pending = null;
      if (!isShare(intent)) { Activity activity = getCurrentActivity(); intent = activity == null ? null : activity.getIntent(); }
      if (!isShare(intent)) { promise.resolve(null); return; }
      intent.putExtra(TAKEN, true);
    }
    final Intent share = intent;
    worker.execute(() -> {
      try { promise.resolve(read(share)); }
      catch (Throwable error) { promise.resolve(null); }
    });
  }
  @SuppressWarnings("deprecation")
  private WritableMap read(Intent intent) {
    WritableMap result = Arguments.createMap();
    CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
    String body = text == null ? null : text.toString().trim();
    if (body != null && body.length() > MAX_TEXT) body = body.substring(0, MAX_TEXT);
    result.putString("text", body == null || body.isEmpty() ? null : body);
    LinkedHashSet<Uri> uris = new LinkedHashSet<>();
    try {
      if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
        ArrayList<Uri> list = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class) : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
        if (list != null) uris.addAll(list);
      } else {
        Uri uri = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class) : intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri != null) uris.add(uri);
      }
    } catch (RuntimeException ignored) { /* A malformed extra is treated as no files. */ }
    ClipData clip = intent.getClipData();
    if (clip != null) for (int index = 0; index < clip.getItemCount(); index++) { Uri uri = clip.getItemAt(index).getUri(); if (uri != null) uris.add(uri); }
    WritableArray files = Arguments.createArray(); int failed = 0;
    File folder = new File(context.getCacheDir(), "lastcall-incoming");
    if (!uris.isEmpty() && !folder.isDirectory() && !folder.mkdirs()) failed = uris.size();
    else for (Uri uri : uris) {
      if (files.size() >= MAX_FILES) { failed++; continue; }
      WritableMap file = copy(uri, intent.getType(), folder);
      if (file == null) failed++; else files.pushMap(file);
    }
    result.putArray("files", files);
    result.putInt("failed", failed);
    return result;
  }
  private WritableMap copy(Uri uri, String sharedType, File folder) {
    String scheme = uri.getScheme();
    if (!ContentResolver.SCHEME_CONTENT.equals(scheme)) return null; // file:// paths of other apps are not readable and not accepted
    ContentResolver resolver = context.getContentResolver();
    String name = null; long declared = -1;
    try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
      if (cursor != null && cursor.moveToFirst()) {
        int nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME), sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE);
        if (nameColumn >= 0 && !cursor.isNull(nameColumn)) name = cursor.getString(nameColumn);
        if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) declared = cursor.getLong(sizeColumn);
      }
    } catch (RuntimeException ignored) { /* Name and size are optional. */ }
    if (declared > MAX_BYTES) return null;
    String mime = null;
    try { mime = resolver.getType(uri); } catch (RuntimeException ignored) {}
    if (mime == null || mime.isEmpty() || mime.length() > 127) mime = sharedType != null && !sharedType.contains("*") && sharedType.length() <= 127 ? sharedType : "application/octet-stream";
    String safe = name == null ? "" : new File(name).getName().replaceAll("[\\u0000-\\u001f/\\\\:*?\"<>|]", "_").trim();
    if (safe.isEmpty() || safe.equals(".") || safe.equals("..")) safe = "file";
    if (safe.length() > 120) safe = safe.substring(safe.length() - 120);
    File target = new File(folder, UUID.randomUUID().toString() + "-" + safe);
    long copied = 0;
    try (InputStream input = resolver.openInputStream(uri); OutputStream output = new FileOutputStream(target)) {
      if (input == null) throw new java.io.IOException("No stream");
      byte[] buffer = new byte[64 * 1024]; int read;
      while ((read = input.read(buffer)) != -1) { copied += read; if (copied > MAX_BYTES) throw new java.io.IOException("Too large"); output.write(buffer, 0, read); }
    } catch (Exception error) { target.delete(); return null; }
    WritableMap file = Arguments.createMap();
    file.putString("path", "file://" + target.getAbsolutePath());
    file.putString("fileName", safe);
    file.putString("mimeType", mime);
    file.putDouble("size", copied);
    return file;
  }
  @Override public void invalidate() { worker.shutdownNow(); super.invalidate(); }
}
