package app.justmoney;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

/**
 * Once a day, looks for a newer JustMoney release on GitHub and says so in a notification. It installs nothing: the user taps the
 * notification, opens Settings → Updates, and confirms the install. Each version is announced once.
 */
public final class UpdateWorker extends Worker {
    private static final String WORK_NAME = "justmoney-update-check";
    private static final String CHANNEL = "updates";
    private static final int NOTIFICATION_ID = 7302;

    public UpdateWorker(@NonNull Context ctx, @NonNull WorkerParameters params) {
        super(ctx, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences p = UpdaterPlugin.prefs(ctx);
        if (!p.getBoolean("daily", true)) return Result.success();
        try {
            JSONObject latest = UpdaterPlugin.fetchLatest();
            String version = latest.getString("version");
            boolean newer = Semver.compare(version, UpdaterPlugin.installedVersion(ctx)) > 0;
            if (newer && !version.equals(p.getString("announced", ""))) {
                notifyNewer(ctx, version);
                p.edit().putString("announced", version).apply();
            }
            return Result.success();
        } catch (Exception e) {
            // no network or GitHub is down: try again later, and give up quietly after a few attempts
            return getRunAttemptCount() < 3 ? Result.retry() : Result.success();
        }
    }

    private static void notifyNewer(Context ctx, String version) {
        try {
            if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return;
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(new NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_DEFAULT));
            }
            Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            PendingIntent pi = PendingIntent.getActivity(ctx, 8, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            nm.notify(NOTIFICATION_ID, new NotificationCompat.Builder(ctx, CHANNEL)
                    .setSmallIcon(smallIcon(ctx))
                    .setContentTitle("A new version of JustMoney is available")
                    .setContentText("Version " + version + " is ready. Open Settings → Updates to install it.")
                    .setContentIntent(pi)
                    .setAutoCancel(true)
                    .build());
        } catch (Exception ignored) {
            // a missing notification must not fail the check
        }
    }

    private static int smallIcon(Context ctx) {
        int id = ctx.getResources().getIdentifier("ic_stat_notify", "drawable", ctx.getPackageName());
        return id != 0 ? id : ctx.getApplicationInfo().icon;
    }

    /** Schedules (or cancels) the daily check. Safe to call on every launch. */
    public static void schedule(Context ctx, boolean enabled) {
        WorkManager wm = WorkManager.getInstance(ctx);
        if (!enabled) {
            wm.cancelUniqueWork(WORK_NAME);
            return;
        }
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(UpdateWorker.class, 24, TimeUnit.HOURS, 3, TimeUnit.HOURS)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build();
        wm.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, req);
    }
}
