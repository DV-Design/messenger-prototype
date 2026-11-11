package dev.messenger.prototype.calls;

import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.SpeechRecognizer;
import com.facebook.react.bridge.*;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.nl.languageid.LanguageIdentification;
import com.google.mlkit.nl.languageid.LanguageIdentifier;
import com.google.mlkit.nl.translate.TranslateLanguage;
import com.google.mlkit.nl.translate.Translation;
import com.google.mlkit.nl.translate.Translator;
import com.google.mlkit.nl.translate.TranslatorOptions;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Live call captions with the phone's own engines. Text is emitted to JS and never logged or stored here. */
public final class LastCallCaptionsModule extends ReactContextBaseJavaModule {
  private LastCallSpeechSession speech;
  private LastCallVoice voice;
  /** Utterances being spoken. While any is, the recognizer hears silence, or it would caption the voice itself. */
  private final java.util.Set<String> voicing = new java.util.HashSet<>();
  private final Map<String, Translator> translators = new HashMap<>();

  LastCallCaptionsModule(ReactApplicationContext context) { super(context); }
  @Override public String getName() { return "LastCallCaptions"; }
  @ReactMethod public void addListener(String eventName) {}
  @ReactMethod public void removeListeners(Integer count) {}
  @Override public void invalidate() {
    UiThreadUtil.runOnUiThread(() -> { if (speech != null) { speech.stop(); speech = null; } closeTranslators(); releaseVoiceNow(); if (identifier != null) { identifier.close(); identifier = null; } });
    super.invalidate();
  }
  private void emit(String type, String key, String value) {
    ReactApplicationContext context = getReactApplicationContext();
    if (!context.hasActiveReactInstance()) return;
    WritableMap event = Arguments.createMap();
    event.putString("type", type); event.putString(key, value);
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("LastCallCaption", event);
  }
  private static WritableMap status(String value, String tag) {
    WritableMap result = Arguments.createMap();
    result.putString("status", value); if (tag != null) result.putString("tag", tag);
    return result;
  }
  private static String match(List<String> languages, String language, String preferred) {
    if (languages == null) return null;
    String found = null;
    for (String tag : languages) {
      if (tag.equalsIgnoreCase(preferred)) return tag;
      String base = Locale.forLanguageTag(tag).getLanguage();
      if (found == null && (language.equals(base) || ("zh".equals(language) && "cmn".equals(base)))) found = tag;
    }
    return found;
  }

  /** "unavailable" also covers cloud-only languages: speech from a call must not leave this phone. */
  @ReactMethod public void speechStatus(String language, String preferred, Promise result) {
    UiThreadUtil.runOnUiThread(() -> {
      ReactApplicationContext context = getReactApplicationContext();
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || !LastCallRecognizers.available(context)) { result.resolve(status("unavailable", null)); return; }
      try {
        new SupportCheck(LastCallRecognizers.create(context), LastCallRecognizers.named(context), language, preferred, result).start(context);
      } catch (RuntimeException error) { result.resolve(status("unavailable", null)); }
    });
  }
  /**
   * Google's recognizer reports ERROR_CANNOT_CHECK_SUPPORT and then the real answer, sometimes twice.
   * The first definite answer wins. A bare "cannot check" means ready only for a recognizer Android
   * itself vouches for as on-device.
   */
  private static final class SupportCheck {
    private static final long AFTER_ERROR_MS = 1500, GIVE_UP_MS = 5000;
    private final SpeechRecognizer recognizer; private final boolean vouched; private final String language, preferred; private final Promise result;
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean settled;
    SupportCheck(SpeechRecognizer recognizer, boolean vouched, String language, String preferred, Promise result) {
      this.recognizer = recognizer; this.vouched = vouched; this.language = language; this.preferred = preferred; this.result = result;
    }
    void start(ReactApplicationContext context) {
      main.postDelayed(() -> settle(status("unavailable", null)), GIVE_UP_MS);
      recognizer.checkRecognitionSupport(LastCallSpeechSession.intent(preferred, null), context.getMainExecutor(), new RecognitionSupportCallback() {
        @Override public void onSupportResult(RecognitionSupport support) { settle(answer(support)); }
        @Override public void onError(int error) {
          boolean cannotCheck = error == SpeechRecognizer.ERROR_CANNOT_CHECK_SUPPORT;
          if (!cannotCheck) { settle(status("unavailable", null)); return; }
          main.postDelayed(() -> settle(status(vouched ? "ready" : "unavailable", vouched ? preferred : null)), AFTER_ERROR_MS);
        }
      });
    }
    private WritableMap answer(RecognitionSupport support) {
      String tag = match(support.getInstalledOnDeviceLanguages(), language, preferred);
      if (tag != null) return status("ready", tag);
      if ((tag = match(support.getPendingOnDeviceLanguages(), language, preferred)) != null) return status("downloading", tag);
      if ((tag = match(support.getSupportedOnDeviceLanguages(), language, preferred)) != null) return status("download", tag);
      return status("unavailable", null);
    }
    private void settle(WritableMap value) {
      if (settled) return;
      settled = true;
      main.removeCallbacksAndMessages(null);
      result.resolve(value);
      try { recognizer.destroy(); } catch (RuntimeException ignored) { /* Its service may already be gone. */ }
    }
  }
  @ReactMethod public void downloadSpeech(String tag, Promise result) {
    UiThreadUtil.runOnUiThread(() -> {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) { result.reject("CAPTIONS", "Android 13 is required"); return; }
      try {
        SpeechRecognizer recognizer = LastCallRecognizers.create(getReactApplicationContext());
        recognizer.triggerModelDownload(LastCallSpeechSession.intent(tag, null));
        recognizer.destroy();
        result.resolve(null);
      } catch (RuntimeException error) { result.reject("CAPTIONS", "Could not request the speech model", error); }
    });
  }
  @ReactMethod public void startSpeech(String tag, Promise result) {
    UiThreadUtil.runOnUiThread(() -> {
      if (speech != null) { speech.stop(); speech = null; }
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) { result.reject("CAPTIONS", "Android 13 is required"); return; }
      speech = new LastCallSpeechSession(getReactApplicationContext(), tag, new LastCallSpeechSession.Events() {
        @Override public void onPartial(String text) { emit("partial", "text", text); }
        @Override public void onFinal(String text) { emit("final", "text", text); }
        @Override public void onFailed(String code) { emit("error", "code", code); }
      });
      speech.setMuted(muted || !voicing.isEmpty());
      speech.start();
      result.resolve(null);
    });
  }
  private volatile boolean muted;
  @ReactMethod public void setSpeechMuted(boolean value) {
    muted = value;
    UiThreadUtil.runOnUiThread(this::applySpeechMute);
  }
  private void applySpeechMute() { if (speech != null) speech.setMuted(muted || !voicing.isEmpty()); }

  private LastCallVoice voice() {
    if (voice == null) voice = new LastCallVoice(getReactApplicationContext(), new LastCallVoice.Events() {
      @Override public void onStart(String id) { voicing.add(id); applySpeechMute(); emit("voice-start", "id", id); }
      @Override public void onDone(String id) { voicing.remove(id); applySpeechMute(); emit("voice-done", "id", id); }
    });
    return voice;
  }
  @ReactMethod public void voiceStatus(String tag, Promise result) {
    UiThreadUtil.runOnUiThread(() -> voice().whenReady(ok -> {
      WritableMap value = Arguments.createMap();
      value.putString("status", ok ? voice.status(tag) : "unavailable");
      result.resolve(value);
    }));
  }
  @ReactMethod public void speak(String text, String tag, String id, Promise result) {
    UiThreadUtil.runOnUiThread(() -> voice().whenReady(ok -> {
      // Counted from the request, so the microphone is quiet before the first sound plays.
      boolean started = ok && voice.speak(text, tag, id);
      if (started) { voicing.add(id); applySpeechMute(); }
      result.resolve(started);
    }));
  }
  @ReactMethod public void stopVoice() {
    UiThreadUtil.runOnUiThread(() -> { if (voice != null) voice.stop(); voicing.clear(); applySpeechMute(); });
  }
  @ReactMethod public void installVoice(Promise result) {
    UiThreadUtil.runOnUiThread(() -> {
      try { voice().install(); result.resolve(null); }
      catch (RuntimeException error) { result.reject("CAPTIONS", "Could not open voice settings", error); }
    });
  }
  private void releaseVoiceNow() { if (voice != null) { voice.shutdown(); voice = null; } voicing.clear(); applySpeechMute(); }
  @ReactMethod public void releaseVoice() { UiThreadUtil.runOnUiThread(this::releaseVoiceNow); }
  @ReactMethod public void stopSpeech() {
    UiThreadUtil.runOnUiThread(() -> { if (speech != null) { speech.stop(); speech = null; } });
  }

  private Translator translator(String source, String target) {
    String from = TranslateLanguage.fromLanguageTag(source), to = TranslateLanguage.fromLanguageTag(target);
    if (from == null || to == null) return null;
    String key = from + ":" + to;
    Translator translator = translators.get(key);
    if (translator == null) {
      translator = Translation.getClient(new TranslatorOptions.Builder().setSourceLanguage(from).setTargetLanguage(to).build());
      translators.put(key, translator);
    }
    return translator;
  }
  /** Only the model comes from Google, and only once; translating itself happens on this phone. */
  @ReactMethod public void prepareTranslation(String source, String target, Promise result) {
    UiThreadUtil.runOnUiThread(() -> {
      Translator translator = translator(source, target);
      if (translator == null) { result.reject("CAPTIONS", "Unsupported language"); return; }
      translator.downloadModelIfNeeded(new DownloadConditions.Builder().build())
        .addOnSuccessListener(unused -> result.resolve(null))
        .addOnFailureListener(error -> result.reject("CAPTIONS", "Could not download the translation", error));
    });
  }
  @ReactMethod public void translate(String source, String target, String text, Promise result) {
    UiThreadUtil.runOnUiThread(() -> {
      Translator translator = translator(source, target);
      if (translator == null) { result.reject("CAPTIONS", "Unsupported language"); return; }
      translator.translate(text)
        .addOnSuccessListener(result::resolve)
        .addOnFailureListener(error -> result.reject("CAPTIONS", "Could not translate"));
    });
  }
  private void closeTranslators() { for (Translator translator : translators.values()) translator.close(); translators.clear(); }
  @ReactMethod public void releaseTranslation() { UiThreadUtil.runOnUiThread(this::closeTranslators); }

  // Chat translation needs the source language of each message; the model ships in the app.
  private LanguageIdentifier identifier;
  /** Resolves a BCP-47 code, or "und" when the language is not recognized with confidence. */
  @ReactMethod public void identifyLanguage(String text, Promise result) {
    UiThreadUtil.runOnUiThread(() -> {
      if (identifier == null) identifier = LanguageIdentification.getClient();
      identifier.identifyLanguage(text == null ? "" : text)
        .addOnSuccessListener(result::resolve)
        .addOnFailureListener(error -> result.resolve("und"));
    });
  }
}
