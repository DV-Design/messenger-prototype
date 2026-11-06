package dev.messenger.prototype.calls;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Speaks translated captions with an offline voice of Google's engine, or of a preinstalled default
 * engine. A voice that needs the network is never chosen, so the words stay on this phone.
 * All TextToSpeech calls run on the main thread.
 */
final class LastCallVoice {
  interface Events { void onStart(String id); void onDone(String id); }
  interface Ready { void run(boolean ok); }
  private static final String GOOGLE = "com.google.android.tts";
  private final Context context;
  private final Events events;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final List<Ready> waiting = new ArrayList<>();
  private TextToSpeech tts;
  private String engine;
  private boolean initialized, ok, triedDefault;

  LastCallVoice(Context context, Events events) { this.context = context.getApplicationContext(); this.events = events; }

  private static boolean system(Context context, String pkg) {
    try { return (context.getPackageManager().getApplicationInfo(pkg, 0).flags & ApplicationInfo.FLAG_SYSTEM) != 0; }
    catch (PackageManager.NameNotFoundException missing) { return false; }
  }
  void whenReady(Ready ready) {
    if (initialized) { ready.run(ok); return; }
    waiting.add(ready);
    if (tts != null) return;
    // Google's engine first, verified by signature; otherwise the firmware's default, if it came with the phone.
    if (LastCallRecognizers.googleSigned(context, GOOGLE)) open(GOOGLE);
    else { triedDefault = true; open(null); }
  }
  private void open(String name) {
    engine = name;
    tts = new TextToSpeech(context, status -> main.post(() -> opened(status == TextToSpeech.SUCCESS)), name);
  }
  private void opened(boolean success) {
    if (tts == null) return;
    String actual = success ? tts.getDefaultEngine() : null;
    if (engine == null && success) success = actual != null && system(context, actual);
    if (!success && !triedDefault) { triedDefault = true; tts.shutdown(); open(null); return; }
    if (success) {
      tts.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
      tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
        @Override public void onStart(String id) { main.post(() -> events.onStart(id)); }
        @Override public void onDone(String id) { main.post(() -> events.onDone(id)); }
        @Override public void onError(String id) { main.post(() -> events.onDone(id)); }
        @Override public void onError(String id, int code) { main.post(() -> events.onDone(id)); }
        @Override public void onStop(String id, boolean interrupted) { main.post(() -> events.onDone(id)); }
      });
    } else { tts.shutdown(); tts = null; }
    initialized = true; ok = success;
    List<Ready> pending = new ArrayList<>(waiting); waiting.clear();
    for (Ready ready : pending) ready.run(ok);
  }

  private static String language(Locale locale) { String value = locale.getLanguage(); return "cmn".equals(value) ? "zh" : value; }
  private Voice voice(String tag, boolean installedOnly) {
    Locale want = Locale.forLanguageTag(tag);
    Set<Voice> voices;
    try { voices = tts.getVoices(); } catch (RuntimeException error) { return null; }
    if (voices == null) return null;
    Voice best = null; int bestScore = -1;
    for (Voice voice : voices) {
      if (voice.isNetworkConnectionRequired() || !language(voice.getLocale()).equals(language(want))) continue;
      boolean missing = voice.getFeatures() != null && voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED);
      if (installedOnly && missing) continue;
      int score = (want.getCountry().equalsIgnoreCase(voice.getLocale().getCountry()) ? 4 : 0) + (voice.getQuality() >= Voice.QUALITY_HIGH ? 2 : 0) + (voice.getLatency() <= Voice.LATENCY_NORMAL ? 1 : 0);
      if (score > bestScore) { best = voice; bestScore = score; }
    }
    return best;
  }
  /** ready: an offline voice is installed. download: the engine has one to install. unavailable: none offline. */
  String status(String tag) {
    if (tts == null) return "unavailable";
    if (voice(tag, true) != null) return "ready";
    return voice(tag, false) != null ? "download" : "unavailable";
  }
  boolean speak(String text, String tag, String id) {
    Voice chosen = tts == null ? null : voice(tag, true);
    if (chosen == null) return false;
    tts.setVoice(chosen);
    Bundle params = new Bundle();
    return tts.speak(text, TextToSpeech.QUEUE_ADD, params, id) == TextToSpeech.SUCCESS;
  }
  void stop() { if (tts != null) tts.stop(); }
  /** Opens the engine's own screen for downloading voices. */
  void install() {
    Intent intent = new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    if (engine != null) intent.setPackage(engine);
    context.startActivity(intent);
  }
  void shutdown() {
    waiting.clear();
    if (tts != null) { try { tts.stop(); tts.shutdown(); } catch (RuntimeException ignored) { /* Engine already gone. */ } tts = null; }
    initialized = false; ok = false; triedDefault = false; engine = null;
  }
}
