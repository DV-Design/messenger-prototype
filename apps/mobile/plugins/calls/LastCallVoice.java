package dev.messenger.prototype.calls;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.Locale;
import java.util.Set;

/**
 * Speaks translated captions with an offline voice of Google's engine, or of a preinstalled default
 * engine. A voice that needs the network is never chosen, so the words stay on this phone.
 *
 * The engine only synthesizes; this app plays the samples itself. Android 16 can mute playback from a
 * background process, and the engine's process is one, while this app is in the foreground for the call.
 * Nothing is written to storage: the engine's file output goes to /dev/null and the samples arrive
 * through onAudioAvailable. All TextToSpeech calls run on the main thread.
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
  private final Map<String, Player> players = new HashMap<>();

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
      tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
        @Override public void onStart(String id) { main.post(() -> events.onStart(id)); }
        @Override public void onBeginSynthesis(String id, int rate, int format, int channels) { Player player = player(id); if (player != null) player.begin(rate, format, channels); }
        @Override public void onAudioAvailable(String id, byte[] audio) { Player player = player(id); if (player != null) player.offer(audio); }
        // Synthesis done: the player finishes playing what it has, then reports the utterance done.
        @Override public void onDone(String id) { Player player = player(id); if (player != null) player.finish(); else main.post(() -> events.onDone(id)); }
        @Override public void onError(String id) { abort(id); }
        @Override public void onError(String id, int code) { abort(id); }
        @Override public void onStop(String id, boolean interrupted) { abort(id); }
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
    ParcelFileDescriptor sink;
    try { sink = ParcelFileDescriptor.open(new File("/dev/null"), ParcelFileDescriptor.MODE_WRITE_ONLY); }
    catch (IOException error) { return false; }
    Player player = new Player(id, sink);
    synchronized (players) { players.put(id, player); }
    if (tts.synthesizeToFile(text, new Bundle(), sink, id) == TextToSpeech.SUCCESS) return true;
    player.close(); return false;
  }
  private Player player(String id) { synchronized (players) { return players.get(id); } }
  private void abort(String id) { Player player = player(id); if (player != null) player.close(); else main.post(() -> events.onDone(id)); }
  void stop() {
    if (tts != null) tts.stop();
    List<Player> all; synchronized (players) { all = new ArrayList<>(players.values()); }
    for (Player player : all) player.close();
  }

  /** Plays one utterance's samples as call audio on its own thread, then reports it done once. */
  private final class Player {
    private static final byte[] END = new byte[0];
    private final String id;
    private final ParcelFileDescriptor sink;
    private final LinkedBlockingQueue<byte[]> chunks = new LinkedBlockingQueue<>();
    private volatile boolean closed, begun;
    private boolean reported;
    Player(String id, ParcelFileDescriptor sink) { this.id = id; this.sink = sink; }

    void begin(int rate, int format, int channels) {
      begun = true;
      Thread thread = new Thread(() -> play(rate, format, channels), "LastCallVoice");
      thread.start();
    }
    void offer(byte[] audio) { if (!closed) chunks.offer(audio); }
    /** An engine that produced no audio never began, so nothing else would report the end. */
    void finish() { chunks.offer(END); if (!begun) done(); }
    void close() { closed = true; chunks.offer(END); done(); }

    private void play(int rate, int format, int channels) {
      AudioTrack track = null;
      try {
        int mask = channels == 2 ? AudioFormat.CHANNEL_OUT_STEREO : AudioFormat.CHANNEL_OUT_MONO;
        int buffer = Math.max(AudioTrack.getMinBufferSize(rate, mask, format), rate / 5 * channels * 2);
        track = new AudioTrack.Builder()
          .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
          .setAudioFormat(new AudioFormat.Builder().setSampleRate(rate).setEncoding(format).setChannelMask(mask).build())
          .setBufferSizeInBytes(buffer).setTransferMode(AudioTrack.MODE_STREAM).build();
        track.play();
        int frameBytes = channels * (format == AudioFormat.ENCODING_PCM_FLOAT ? 4 : format == AudioFormat.ENCODING_PCM_8BIT ? 1 : 2);
        long frames = 0;
        while (!closed) {
          byte[] chunk = chunks.take();
          if (chunk == END) break;
          int written = track.write(chunk, 0, chunk.length);
          if (written > 0) frames += written / frameBytes;
        }
        // Wait for the tail to leave the speaker, so the microphone opens only after the voice ends.
        long deadline = System.currentTimeMillis() + 1000 + frames * 1000 / Math.max(1, rate);
        while (!closed && (track.getPlaybackHeadPosition() & 0xffffffffL) < frames && System.currentTimeMillis() < deadline) Thread.sleep(20);
      } catch (InterruptedException | RuntimeException error) { /* Ends this utterance; the next one starts clean. */ }
      finally {
        if (track != null) { try { track.stop(); } catch (RuntimeException ignored) { /* Never started. */ } track.release(); }
        done();
      }
    }
    private void done() {
      synchronized (this) { if (reported) return; reported = true; }
      synchronized (players) { players.remove(id); }
      try { sink.close(); } catch (IOException ignored) { /* Already closed. */ }
      main.post(() -> events.onDone(id));
    }
  }
  /** Opens the engine's own screen for downloading voices. */
  void install() {
    Intent intent = new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    if (engine != null) intent.setPackage(engine);
    context.startActivity(intent);
  }
  void shutdown() {
    waiting.clear();
    stop();
    if (tts != null) { try { tts.stop(); tts.shutdown(); } catch (RuntimeException ignored) { /* Engine already gone. */ } tts = null; }
    initialized = false; ok = false; triedDefault = false; engine = null;
  }
}
