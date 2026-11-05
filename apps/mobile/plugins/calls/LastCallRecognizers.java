package dev.messenger.prototype.calls;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.IBinder;
import android.speech.RecognitionService;
import android.speech.SpeechRecognizer;
import java.io.File;

/**
 * Chooses the on-device recognizer. Some firmware (vivo's China builds) names none, so Android reports
 * none even with Google's offline recognizer installed. Only that exact service, verified by signature,
 * is used then; a language counts only when it reports on-device support, so no cloud path is chosen.
 */
final class LastCallRecognizers {
  private static final ComponentName GOOGLE = new ComponentName("com.google.android.tts", "com.google.android.apps.speech.tts.googletts.service.GoogleTTSRecognitionService");
  private static final String[] GOOGLE_CERTS = { "7ce83c1b71f3d572fed04c8d40c5cb10ff75e6d87d9df6fbd53f0468c2905053", "f0fd6c5b410f25cb25c3b53346c8972fae30f8ee7411df910480ad6b2d60db83" };
  private static final String TEST_AUDIO = "dev.messenger.prototype.captionTestAudio";
  private LastCallRecognizers() {}

  private static byte[] hex(String value) {
    byte[] bytes = new byte[value.length() / 2];
    for (int index = 0; index < bytes.length; index++) bytes[index] = (byte) Integer.parseInt(value.substring(index * 2, index * 2 + 2), 16);
    return bytes;
  }
  private static boolean trustedGoogle(Context context) {
    PackageManager manager = context.getPackageManager();
    try { manager.getServiceInfo(GOOGLE, 0); }
    catch (PackageManager.NameNotFoundException missing) { return false; }
    for (String cert : GOOGLE_CERTS) if (manager.hasSigningCertificate(GOOGLE.getPackageName(), hex(cert), PackageManager.CERT_INPUT_SHA256)) return true;
    return false;
  }
  /** An emulator always names a recognizer, so only an explicit test build can exercise the other path. */
  private static boolean testForcesGoogle(Context context) {
    try {
      ApplicationInfo info = context.getPackageManager().getApplicationInfo(context.getPackageName(), PackageManager.GET_META_DATA);
      return info.metaData != null && info.metaData.getBoolean(TEST_AUDIO, false) && new File(context.getExternalFilesDir(null), "caption-force-google").isFile();
    } catch (PackageManager.NameNotFoundException | RuntimeException error) { return false; }
  }
  /**
   * Android binds a recognizer on the app's behalf from the system process, which gives it no share of
   * this call's priority. vivo's freezer then stops Google's service about 11 s in. Our own binding lifts
   * it for exactly as long as the session runs. Returns null when no binding is needed or possible.
   */
  static ServiceConnection hold(Context context) {
    if (named(context) || !trustedGoogle(context)) return null;
    ServiceConnection connection = new ServiceConnection() {
      @Override public void onServiceConnected(ComponentName name, IBinder service) {}
      @Override public void onServiceDisconnected(ComponentName name) {}
    };
    try {
      Intent intent = new Intent(RecognitionService.SERVICE_INTERFACE).setComponent(GOOGLE);
      if (context.bindService(intent, connection, Context.BIND_AUTO_CREATE | Context.BIND_IMPORTANT)) return connection;
      context.unbindService(connection);
    } catch (RuntimeException failed) { /* Recognition still runs; on most firmware it does not need this. */ }
    return null;
  }
  static boolean named(Context context) { return SpeechRecognizer.isOnDeviceRecognitionAvailable(context) && !testForcesGoogle(context); }
  static boolean available(Context context) { return named(context) || trustedGoogle(context); }
  /** Throws if no recognizer is available; callers check available() and catch. */
  static SpeechRecognizer create(Context context) {
    if (named(context)) return SpeechRecognizer.createOnDeviceSpeechRecognizer(context);
    if (!trustedGoogle(context)) throw new UnsupportedOperationException("No on-device recognizer");
    return SpeechRecognizer.createSpeechRecognizer(context, GOOGLE);
  }
}
