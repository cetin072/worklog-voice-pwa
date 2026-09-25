const fs = require('node:fs');
const path = require('node:path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const RECEIVER_NAME = '.ReminderBootReceiver';
const RECEIVE_BOOT_COMPLETED = 'android.permission.RECEIVE_BOOT_COMPLETED';
const ACTIONS = [
  'android.intent.action.BOOT_COMPLETED',
  'android.intent.action.REBOOT',
  'android.intent.action.USER_UNLOCKED',
  'android.intent.action.MY_PACKAGE_REPLACED',
  'android.intent.action.QUICKBOOT_POWERON',
  'com.htc.intent.action.QUICKBOOT_POWERON',
  'android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED',
];

function ensurePermission(manifest, permission) {
  manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] || [];
  const permissions = manifest.manifest['uses-permission'];
  if (!permissions.some((entry) => entry.$?.['android:name'] === permission)) {
    permissions.push({ $: { 'android:name': permission } });
  }
}

function ensureReceiver(application) {
  application.receiver = application.receiver || [];
  const existing = application.receiver.find((entry) => entry.$?.['android:name'] === RECEIVER_NAME);
  const receiver = existing || {
    $: {
      'android:name': RECEIVER_NAME,
      'android:enabled': 'true',
      'android:exported': 'false',
    },
    'intent-filter': [],
  };

  const filter = receiver['intent-filter']?.[0] || { action: [] };
  filter.action = filter.action || [];
  for (const action of ACTIONS) {
    if (!filter.action.some((entry) => entry.$?.['android:name'] === action)) {
      filter.action.push({ $: { 'android:name': action } });
    }
  }
  receiver['intent-filter'] = [filter];

  if (!existing) application.receiver.push(receiver);
}

function kotlinSource(packageName) {
  return `package ${packageName}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import expo.modules.notifications.service.delegates.ExpoSchedulingDelegate
import kotlin.concurrent.thread

/**
 * Redundant native recovery for schedule reminders after Android reboot/update.
 *
 * expo-notifications already owns the notification store and its primary boot
 * receiver. This receiver deliberately replays that same native store on boot,
 * user unlock, package replacement, and exact-alarm access changes. Replaying
 * is idempotent because expo-notifications schedules by the existing request
 * identifier/PendingIntent.
 */
class ReminderBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action !in RECOVERY_ACTIONS) return

    val pendingResult = goAsync()
    thread(name = "worklog-reminder-boot-recovery") {
      try {
        ExpoSchedulingDelegate(context.applicationContext).setupScheduledNotifications()
        Log.i(TAG, "Replayed scheduled notifications after $action")
      } catch (error: Exception) {
        Log.e(TAG, "Scheduled notification replay failed after $action", error)
      } finally {
        pendingResult.finish()
      }
    }
  }

  companion object {
    private const val TAG = "WorklogReminderBoot"
    private val RECOVERY_ACTIONS = setOf(
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_REBOOT,
      Intent.ACTION_USER_UNLOCKED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      "android.intent.action.QUICKBOOT_POWERON",
      "com.htc.intent.action.QUICKBOOT_POWERON",
      "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED",
    )
  }
}
`;
}

function withBootReminderManifest(config) {
  return withAndroidManifest(config, (nextConfig) => {
    ensurePermission(nextConfig.modResults, RECEIVE_BOOT_COMPLETED);
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(nextConfig.modResults);
    ensureReceiver(application);
    return nextConfig;
  });
}

function withBootReminderSource(config) {
  return withDangerousMod(config, [
    'android',
    async (nextConfig) => {
      const packageName = nextConfig.android?.package;
      if (!packageName) throw new Error('Android package name is required for ReminderBootReceiver');

      const sourceDir = path.join(
        nextConfig.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        ...packageName.split('.'),
      );
      await fs.promises.mkdir(sourceDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(sourceDir, 'ReminderBootReceiver.kt'),
        kotlinSource(packageName),
        'utf8',
      );
      return nextConfig;
    },
  ]);
}

module.exports = function withWorklogBootReminderRecovery(config) {
  return withBootReminderSource(withBootReminderManifest(config));
};
