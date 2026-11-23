package dev.messenger.prototype.share;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * "LastCall" in the text selection menu of any app. It has no screen of its own: the selected text
 * is handed to the main activity as an ordinary text share, so the same chat picker handles both.
 */
public final class LastCallProcessTextActivity extends Activity {
  private static final int MAX_CHARS = 4000;
  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    try {
      CharSequence selected = getIntent() == null ? null : getIntent().getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
      String text = selected == null ? "" : selected.toString().trim();
      if (!text.isEmpty()) {
        if (text.length() > MAX_CHARS) text = text.substring(0, MAX_CHARS);
        Intent share = new Intent(Intent.ACTION_SEND);
        share.setClassName(getPackageName(), "dev.messenger.prototype.MainActivity");
        share.setType("text/plain");
        share.putExtra(Intent.EXTRA_TEXT, text);
        share.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(share);
      }
    } catch (RuntimeException ignored) {
      // Nothing to hand over; the selection menu simply closes.
    }
    finish();
  }
}
