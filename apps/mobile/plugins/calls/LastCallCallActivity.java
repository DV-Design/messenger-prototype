package dev.messenger.prototype.calls;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.telecom.Connection;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import io.wazo.callkeep.VoiceConnectionService;

/** Call-only lockscreen surface: no chat, navigation or history. */
public final class LastCallCallActivity extends Activity {
  private String uuid;
  private boolean answering;
  private TextView hint;
  private Button answerButton;
  private Button declineButton;

  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    Intent intent = getIntent();
    LastCallCallUiService.Entry entry = LastCallCallUiService.validate(intent);
    if (entry == null) { finish(); return; }
    if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
    else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
    LastCallCallUiService.bindScreen(this, entry.uuid);
    render(entry);
    performAction(intent.getAction());
  }

  @Override protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent); setIntent(intent);
    LastCallCallUiService.Entry entry = LastCallCallUiService.validate(intent);
    if (entry == null) { finish(); return; }
    render(entry); performAction(intent.getAction());
  }

  private void render(LastCallCallUiService.Entry entry) {
    if (!entry.uuid.equals(uuid)) answering = false;
    uuid = entry.uuid;
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setGravity(Gravity.CENTER);
    root.setPadding(dp(28), dp(48), dp(28), dp(48));
    root.setBackgroundColor(Color.rgb(17, 24, 39));
    root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);

    TextView label = new TextView(this);
    label.setText("LastCall · входящий звонок");
    label.setTextColor(Color.rgb(156, 163, 175));
    label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
    label.setGravity(Gravity.CENTER);
    root.addView(label);

    TextView name = new TextView(this);
    name.setText(entry.name);
    name.setTextColor(Color.WHITE);
    name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 30);
    name.setGravity(Gravity.CENTER);
    name.setPadding(0, dp(18), 0, dp(10));
    root.addView(name);

    hint = new TextView(this);
    hint.setText(entry.video ? "Видеозвонок начнётся после ответа" : "Микрофон включится только после ответа");
    hint.setTextColor(Color.rgb(156, 163, 175));
    hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
    hint.setGravity(Gravity.CENTER);
    hint.setPadding(0, 0, 0, dp(36));
    root.addView(hint);

    Button decline = new Button(this);
    declineButton = decline;
    decline.setText("Отклонить");
    decline.setOnClickListener(view -> decline());
    root.addView(decline, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)));

    Button answer = new Button(this);
    answerButton = answer;
    answer.setText("Принять");
    answer.setOnClickListener(view -> answer());
    LinearLayout.LayoutParams answerParams = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56));
    answerParams.topMargin = dp(14);
    root.addView(answer, answerParams);

    setContentView(root);
    if (answering) showConnecting();
  }

  private void performAction(String action) {
    if (LastCallCallUiService.ACTION_ANSWER.equals(action)) answer();
    else if (LastCallCallUiService.ACTION_DECLINE.equals(action)) decline();
  }

  private void answer() {
    LastCallCallUiService.Entry entry = LastCallCallUiService.current();
    if (entry == null || uuid == null || !uuid.equals(entry.uuid) || entry.expiresAt <= System.currentTimeMillis()) { finish(); return; }
    if (answering) return;
    answering = true; showConnecting();
    Connection connection = uuid == null ? null : VoiceConnectionService.getConnection(uuid);
    if (connection != null) connection.onAnswer();
    else LastCallCallUiService.dispatchAction(this, uuid, LastCallCallUiService.ACTION_ANSWER);
    // Keep this call-only Activity visible while Android grants while-in-use microphone/camera access.
    // Core's actual active session or matching cancel/expiry closes it, never an early answer receipt.
  }

  private void showConnecting() {
    if (hint != null) hint.setText("Подключаем…");
    if (answerButton != null) { answerButton.setText("Подключаем…"); answerButton.setEnabled(false); }
    if (declineButton != null) declineButton.setText("Завершить");
  }

  private void decline() {
    if (uuid != null) LastCallAudioService.end(getApplicationContext(), uuid);
    Connection connection = uuid == null ? null : VoiceConnectionService.getConnection(uuid);
    if (connection != null) connection.onReject();
    else LastCallCallUiService.dispatchAction(this, uuid, LastCallCallUiService.ACTION_DECLINE);
    LastCallCallUiService.stop(getApplicationContext(), uuid);
    finish();
  }

  @Override public void onBackPressed() {
    // Keep ringing: dismissing the call-only screen must not silently answer or reject.
  }

  @Override protected void onDestroy() {
    LastCallCallUiService.clearScreen(this);
    super.onDestroy();
  }

  private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
