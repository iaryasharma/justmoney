package app.justmoney;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * The pinned "tap to add an expense" notification. It is held by a foreground service, which is how Android keeps a notification that cannot be
 * swiped away (on newer Android versions an ordinary "ongoing" notification can be dismissed). Runs only while the user has the pinned
 * notification switched on in Settings, and does nothing else.
 */
public class QuickAddService extends Service {
    static final String PREFS = "justmoney_pinned";
    private static final String CHANNEL = "pinned_quick_add";
    private static final int ID = 7302;

    static boolean wanted(Context ctx) {
        return ctx.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("on", false);
    }

    /** Starts or stops the service to match what the user chose. */
    static void apply(Context ctx, boolean on) {
        ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("on", on).apply();
        Intent i = new Intent(ctx, QuickAddService.class);
        try {
            if (on) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i); else ctx.startService(i);
            } else {
                ctx.stopService(i);
            }
        } catch (Exception ignored) {
            // Android may refuse to start it from the background; the next time the app is opened it is started again
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Pinned quick add", NotificationManager.IMPORTANCE_LOW);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
            Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("justmoney://add"), this, MainActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pi = PendingIntent.getActivity(this, 8, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification n = new NotificationCompat.Builder(this, CHANNEL)
                    .setSmallIcon(smallIcon())
                    .setContentTitle("JustMoney")
                    .setContentText("Tap to add an expense")
                    .setContentIntent(pi)
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                    .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                    .build();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(ID, n);
            }
        } catch (Exception e) {
            stopSelf();
        }
        return START_STICKY;
    }

    private int smallIcon() {
        int id = getResources().getIdentifier("ic_stat_notify", "drawable", getPackageName());
        return id != 0 ? id : getApplicationInfo().icon;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
