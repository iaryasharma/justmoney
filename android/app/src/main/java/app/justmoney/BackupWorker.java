package app.justmoney;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

/** Runs the daily backup in the background, even when the app is closed. */
public final class BackupWorker extends Worker {
    private static final String WORK_NAME = "justmoney-daily-backup";

    public BackupWorker(@NonNull Context ctx, @NonNull WorkerParameters params) {
        super(ctx, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            Context ctx = getApplicationContext();
            SharedPreferences p = BackupWriter.prefs(ctx);
            long before = p.getLong("lastAt", 0);
            BackupWriter.backupIfDue(ctx);
            if (p.getLong("lastAt", 0) > before) notifyDone(ctx);
            return Result.success();
        } catch (SecurityException e) {
            return Result.failure(); // no storage permission (Android 9 and older); retrying won't help
        } catch (Exception e) {
            return getRunAttemptCount() < 3 ? Result.retry() : Result.failure();
        }
    }

    /** "Backup saved", when the user has that alert on (the app tells us through setBackupNotify). */
    static void notifyDone(Context ctx) {
        try {
            if (!BackupWriter.prefs(ctx).getBoolean("notifyDone", true)) return;
            if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return;
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(new NotificationChannel("backup_done", "Backups", NotificationManager.IMPORTANCE_LOW));
            }
            Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            PendingIntent pi = PendingIntent.getActivity(ctx, 7, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            nm.notify(7301, new NotificationCompat.Builder(ctx, "backup_done")
                    .setSmallIcon(smallIcon(ctx))
                    .setContentTitle("Backup saved")
                    .setContentText("Your encrypted JustMoney backup was saved.")
                    .setContentIntent(pi).setAutoCancel(true).build());
        } catch (Exception ignored) {
            // a missing notification must never fail the backup
        }
    }

    private static int smallIcon(Context ctx) {
        int id = ctx.getResources().getIdentifier("ic_stat_notify", "drawable", ctx.getPackageName());
        return id != 0 ? id : ctx.getApplicationInfo().icon;
    }

    /** Schedules (or cancels) the once-a-day job. Safe to call on every launch. */
    public static void schedule(Context ctx, boolean enabled) {
        WorkManager wm = WorkManager.getInstance(ctx);
        if (!enabled) {
            wm.cancelUniqueWork(WORK_NAME);
            return;
        }
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(BackupWorker.class, 24, TimeUnit.HOURS, 3, TimeUnit.HOURS)
                .setConstraints(new Constraints.Builder().setRequiresBatteryNotLow(true).build())
                .build();
        wm.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, req);
    }
}
