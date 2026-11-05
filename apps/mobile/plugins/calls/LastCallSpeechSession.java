package dev.messenger.prototype.calls;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * On-device recognition of WebRTC's microphone samples. It never opens the microphone and never falls
 * back to a cloud recognizer. All SpeechRecognizer calls run on the main thread, as Android requires.
 */
final class LastCallSpeechSession implements LastCallAudioTap.Sink {
  interface Events { void onPartial(String text); void onFinal(String text); void onFailed(String code); }
  private static final int RATE = 16000;
  private static final int QUEUE_CHUNKS = 200; // About 2 s of 10 ms chunks; older speech is not worth blocking audio for.
  private static final int MAX_QUICK_FAILURES = 5;
  private static final long QUICK_MS = 2000;
  private static final String TEST_AUDIO = "dev.messenger.prototype.captionTestAudio";

  private final Context context;
  private final String tag;
  private final Events events;
  private final Handler main = new Handler(Looper.getMainLooper());
  private volatile ArrayBlockingQueue<byte[]> queue;
  private volatile boolean muted;
  private volatile boolean running;
  private SpeechRecognizer recognizer;
  private ParcelFileDescriptor readSide;
  private Thread writer;
  private long startedAt;
  private int quickFailures;
  private double phase;
  private byte[] testPcm;
  private int testOffset;

  LastCallSpeechSession(Context context, String tag, Events events) {
    this.context = context.getApplicationContext(); this.tag = tag; this.events = events;
  }
  void setMuted(boolean value) { muted = value; }

  void start() {
    testPcm = loadTestAudio();
    running = true;
    LastCallAudioTap.setSink(this);
    listen();
  }
  void stop() {
    running = false;
    LastCallAudioTap.setSink(null);
    main.removeCallbacksAndMessages(null);
    closeRecognition();
  }

  /** Runs on WebRTC's audio thread, so it only converts and offers. */
  @Override public void onSamples(byte[] data, int sampleRate, int channels) {
    ArrayBlockingQueue<byte[]> target = queue;
    if (target == null || sampleRate <= 0 || channels <= 0) return;
    byte[] chunk = downsample(data, sampleRate, channels);
    if (chunk.length == 0) return;
    if (muted) java.util.Arrays.fill(chunk, (byte) 0);
    else if (testPcm != null) fillTest(chunk);
    target.offer(chunk);
  }
  /** Averages down to 16 kHz mono. Each output sample covers its input span, which prevents aliasing into speech. */
  private byte[] downsample(byte[] data, int sampleRate, int channels) {
    int frames = data.length / (2 * channels);
    double step = (double) sampleRate / RATE;
    byte[] output = new byte[(int) ((frames + phase) / step + 1) * 2];
    int written = 0; double position = phase;
    while (position + step <= frames) {
      int from = Math.max(0, (int) position), to = Math.max(from + 1, (int) (position + step));
      long sum = 0; int count = 0;
      for (int frame = from; frame < to && frame < frames; frame++) for (int channel = 0; channel < channels; channel++) {
        int at = (frame * channels + channel) * 2;
        sum += (short) ((data[at] & 0xff) | (data[at + 1] << 8)); count++;
      }
      int value = count == 0 ? 0 : (int) (sum / count);
      output[written++] = (byte) value; output[written++] = (byte) (value >> 8);
      position += step;
    }
    phase = position - frames;
    return written == output.length ? output : java.util.Arrays.copyOf(output, written);
  }
  private void fillTest(byte[] chunk) {
    for (int index = 0; index < chunk.length; index++) chunk[index] = testOffset < testPcm.length ? testPcm[testOffset++] : 0;
  }
  /** Reproducible speech for emulators, whose microphone is silent. Absent from store and release builds' manifests. */
  private byte[] loadTestAudio() {
    try {
      ApplicationInfo info = context.getPackageManager().getApplicationInfo(context.getPackageName(), PackageManager.GET_META_DATA);
      if (info.metaData == null || !info.metaData.getBoolean(TEST_AUDIO, false)) return null;
      File file = new File(context.getExternalFilesDir(null), "caption-test.pcm");
      if (!file.isFile()) return null;
      try (FileInputStream input = new FileInputStream(file)) {
        byte[] bytes = new byte[(int) file.length()];
        int read = input.read(bytes);
        testOffset = 0;
        return read == bytes.length ? bytes : null;
      }
    } catch (PackageManager.NameNotFoundException | IOException | RuntimeException error) { return null; }
  }

  private void listen() {
    if (!running) return;
    closeRecognition();
    startedAt = System.currentTimeMillis();
    try {
      ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
      readSide = pipe[0];
      ArrayBlockingQueue<byte[]> target = new ArrayBlockingQueue<>(QUEUE_CHUNKS);
      queue = target;
      writer = new Thread(() -> pump(target, pipe[1]), "LastCallSpeechAudio");
      writer.start();
      recognizer = LastCallRecognizers.create(context);
      recognizer.setRecognitionListener(listener);
      recognizer.startListening(intent(tag, readSide));
    } catch (IOException | RuntimeException error) { failed("start"); }
  }
  static Intent intent(String tag, ParcelFileDescriptor audio) {
    Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
      .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      .putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag)
      .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
    if (audio != null) intent
      .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, audio)
      .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
      .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
      .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, RATE)
      .putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE);
    return intent;
  }
  private void pump(ArrayBlockingQueue<byte[]> source, ParcelFileDescriptor writeSide) {
    try (OutputStream output = new ParcelFileDescriptor.AutoCloseOutputStream(writeSide)) {
      while (running && queue == source) {
        byte[] chunk = source.poll(200, TimeUnit.MILLISECONDS);
        if (chunk != null) output.write(chunk);
      }
    } catch (IOException | InterruptedException ended) { /* The recognizer closed its side, or this session stopped. */ }
  }
  private void closeRecognition() {
    queue = null;
    if (writer != null) { writer.interrupt(); writer = null; }
    if (recognizer != null) {
      try { recognizer.destroy(); } catch (RuntimeException ignored) { /* Its service may already be gone. */ }
      recognizer = null;
    }
    if (readSide != null) { try { readSide.close(); } catch (IOException ignored) { /* Already closed. */ } readSide = null; }
  }
  private void failed(String code) {
    if (!running) return;
    running = false;
    LastCallAudioTap.setSink(null);
    closeRecognition();
    events.onFailed(code);
  }
  /** A recognizer without segmented sessions ends after each phrase; a broken one ends immediately and repeatedly. */
  private void restart(String code) {
    if (!running) return;
    quickFailures = System.currentTimeMillis() - startedAt < QUICK_MS ? quickFailures + 1 : 0;
    if (quickFailures >= MAX_QUICK_FAILURES) { failed(code); return; }
    main.postDelayed(this::listen, quickFailures == 0 ? 0 : 300L * quickFailures);
  }
  private static String first(Bundle results) {
    ArrayList<String> items = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
    return items == null || items.isEmpty() || items.get(0) == null ? "" : items.get(0);
  }

  private final RecognitionListener listener = new RecognitionListener() {
    @Override public void onReadyForSpeech(Bundle params) {}
    @Override public void onBeginningOfSpeech() {}
    @Override public void onRmsChanged(float rmsdB) {}
    @Override public void onBufferReceived(byte[] buffer) {}
    @Override public void onEndOfSpeech() {}
    @Override public void onEvent(int eventType, Bundle params) {}
    @Override public void onPartialResults(Bundle results) { String text = first(results); if (running && !text.isEmpty()) events.onPartial(text); }
    @Override public void onSegmentResults(Bundle results) { quickFailures = 0; String text = first(results); if (running && !text.isEmpty()) events.onFinal(text); }
    @Override public void onEndOfSegmentedSession() { restart("ended"); }
    @Override public void onResults(Bundle results) { String text = first(results); if (running && !text.isEmpty()) { quickFailures = 0; events.onFinal(text); } restart("ended"); }
    @Override public void onError(int error) {
      switch (error) {
        case SpeechRecognizer.ERROR_NO_MATCH: case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
        case SpeechRecognizer.ERROR_SERVER_DISCONNECTED: case SpeechRecognizer.ERROR_TOO_MANY_REQUESTS:
          restart("error-" + error); break;
        default: failed("error-" + error);
      }
    }
  };
}
