package dev.messenger.prototype.calls;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Timestamps of fixed stage names on the incoming-call path, for the diagnostics report. It shows
 * how far a call got on a phone we cannot attach to. Stage names only: no IDs, names or content.
 */
final class LastCallCallTrace {
  private static final String PREFS = "lastcall-call-trace-v1";
  private static final String KEY = "stages";
  private static final int LIMIT = 40;

  static synchronized void add(Context context, String stage) {
    Log.i("LastCallCall", stage);
    try {
      SharedPreferences preferences = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
      String time = new SimpleDateFormat("HH:mm:ss.SSS", Locale.ROOT).format(new Date());
      String previous = preferences.getString(KEY, "");
      String next = previous.isEmpty() ? time + " " + stage : previous + "\n" + time + " " + stage;
      String[] lines = next.split("\n");
      if (lines.length > LIMIT) {
        StringBuilder kept = new StringBuilder();
        for (int index = lines.length - LIMIT; index < lines.length; index++) {
          if (kept.length() > 0) kept.append('\n');
          kept.append(lines[index]);
        }
        next = kept.toString();
      }
      preferences.edit().putString(KEY, next).apply();
    } catch (RuntimeException ignored) {
      // Diagnostics must never affect a call.
    }
  }

  static synchronized List<String> read(Context context) {
    List<String> result = new ArrayList<>();
    String stored = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "");
    if (!stored.isEmpty()) for (String line : stored.split("\n")) result.add(line);
    return result;
  }

  private LastCallCallTrace() {}
}
