package dev.messenger.prototype.calls;

import android.os.Build;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.SpeechRecognizer;
import com.facebook.react.bridge.*;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.google.mlkit.common.model.DownloadConditions;
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
  private final Map<String, Translator> translators = new HashMap<>();

  LastCallCaptionsModule(ReactApplicationContext context) { super(context); }
  @Override public String getName() { return "LastCallCaptions"; }
  @ReactMethod public void addListener(String eventName) {}
  @ReactMethod public void removeListeners(Integer count) {}
  @Override public void invalidate() {
    UiThreadUtil.runOnUiThread(() -> { if (speech != null) { speech.stop(); speech = null; } closeTranslators(); });
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
      if (found == null && language.equals(Locale.forLanguageTag(tag).getLanguage())) found = tag;
    }
    return found;
  }

  /** "unavailable" also covers cloud-only languages: speech from a call must not leave this phone. */
  @ReactMethod public void speechStatus(String language, String preferred, Promise result) {
    UiThreadUtil.runOnUiThread(() -> {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || !SpeechRecognizer.isOnDeviceRecognitionAvailable(getReactApplicationContext())) {
        result.resolve(status("unavailable", null)); return;
      }
      try {
        SpeechRecognizer recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(getReactApplicationContext());
        recognizer.checkRecognitionSupport(LastCallSpeechSession.intent(preferred, null), getReactApplicationContext().getMainExecutor(), new RecognitionSupportCallback() {
          @Override public void onSupportResult(RecognitionSupport support) {
            String tag = match(support.getInstalledOnDeviceLanguages(), language, preferred);
            if (tag != null) result.resolve(status("ready", tag));
            else if ((tag = match(support.getPendingOnDeviceLanguages(), language, preferred)) != null) result.resolve(status("downloading", tag));
            else if ((tag = match(support.getSupportedOnDeviceLanguages(), language, preferred)) != null) result.resolve(status("download", tag));
            else result.resolve(status("unavailable", null));
            recognizer.destroy();
          }
          @Override public void onError(int error) {
            result.resolve(status(error == SpeechRecognizer.ERROR_CANNOT_CHECK_SUPPORT ? "ready" : "unavailable", preferred));
            recognizer.destroy();
          }
        });
      } catch (RuntimeException error) { result.resolve(status("unavailable", null)); }
    });
  }
  @ReactMethod public void downloadSpeech(String tag, Promise result) {
    UiThreadUtil.runOnUiThread(() -> {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) { result.reject("CAPTIONS", "Android 13 is required"); return; }
      try {
        SpeechRecognizer recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(getReactApplicationContext());
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
      speech.setMuted(muted);
      speech.start();
      result.resolve(null);
    });
  }
  private volatile boolean muted;
  @ReactMethod public void setSpeechMuted(boolean value) {
    muted = value;
    UiThreadUtil.runOnUiThread(() -> { if (speech != null) speech.setMuted(value); });
  }
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
}
