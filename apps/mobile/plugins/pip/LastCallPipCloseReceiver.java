package dev.messenger.prototype.pip;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Only our immutable explicit PiP close PendingIntent can target this non-exported receiver. */
public final class LastCallPipCloseReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context context, Intent intent) {
    if (LastCallPip.CLOSE.equals(intent.getAction())) LastCallPip.close(intent.getStringExtra("callId"));
  }
}
