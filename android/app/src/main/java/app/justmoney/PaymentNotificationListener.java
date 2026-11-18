package app.justmoney;

import android.app.Notification;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.core.app.NotificationManagerCompat;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.regex.Pattern;

/**
 * Watches notifications for completed payments (UPI apps, bank apps, and bank SMS
 * shown by the messaging app). Only notifications that look like a money movement
 * are kept, in the app's private database; everything else is ignored and never stored.
 */
public class PaymentNotificationListener extends NotificationListenerService {
    private static final Pattern AMOUNT = Pattern.compile("(?i)(₹|\\brs\\.?|\\binr)\\s?[0-9][0-9,]*(\\.[0-9]{1,2})?|(debited|credited)\\s+(by|with|for)\\s+[0-9][0-9,]*(\\.[0-9]{1,2})?");
    private static final Pattern MONEY_WORDS = Pattern.compile("(?i)\\b(paid|debited|credited|received|sent|spent|payment|transferred|withdrawn|deposited|refund(ed)?|cashback|purchase)\\b");
    private static final Pattern IGNORE = Pattern.compile("(?i)\\b(otp|one time password|verification code|will be debited|is due|due on|due date|bill generated|collect request|requested money|request of|offer|cashback upto|win|reward points|recharge now|pay now)\\b");
    /** Usually no money moved, unless the message also says it did ("refund for failed txn credited", "debited towards your mandate"). */
    private static final Pattern NOT_MOVED_UNLESS_DONE = Pattern.compile("(?i)\\b(failed|declined|mandate)\\b");
    private static final Pattern DONE = Pattern.compile("(?i)\\b(credited|debited|refunded|deducted|reversed)\\b");

    /** Block / unblock notices of IPO applications and UPI mandates: "Informed your Bank to unblock Rs. 15000.00 for ... IPO ... due to non-allotment". */
    private static final Pattern HOLD_WORDS = Pattern.compile("(?i)\\b(un-?block(ed|ing)?|blocked|lien|asba|sbmd|upi[- ]?mandate|mandate (created|revoked|modified)|(amount|funds?) (has been )?(reserved|released))\\b");
    private static final Pattern IGNORE_ALWAYS = Pattern.compile("(?i)\\b(otp|one time password|verification code|offer|win|reward points|recharge now|pay now|failed|declined)\\b");

    /** Set by the app while it is open, so a capture can be processed right away. */
    public interface Callback { void onCaptured(); }
    public static volatile Callback callback;

    /** Capture writes run here, never on the main thread: a slow database or Keystore must not freeze the phone or drop a payment. */
    static final java.util.concurrent.ExecutorService IO = java.util.concurrent.Executors.newSingleThreadExecutor();

    /** True while the system is delivering notifications to this listener. */
    static volatile boolean connected;

    @Override
    public void onListenerConnected() { connected = true; }

    @Override
    public void onListenerDisconnected() {
        // the system dropped the listener (an app update, memory pressure, Samsung's battery manager): ask to be bound again
        connected = false;
        try { requestRebind(new ComponentName(this, PaymentNotificationListener.class)); } catch (Exception ignored) { }
    }

    /**
     * Called whenever the app comes to the front. Notification access can stay granted while the listener itself is no longer bound
     * (seen on a Galaxy S24 FE after updates): nothing is delivered and payments go missing. If it is not connected a few seconds after
     * the app opens, ask for a rebind, and as a last resort switch the component off and on, which makes the system bind it afresh.
     */
    static void ensureBound(Context ctx) {
        Context app = ctx.getApplicationContext();
        if (!NotificationManagerCompat.getEnabledListenerPackages(app).contains(app.getPackageName())) return;
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (connected) return;
            ComponentName c = new ComponentName(app, PaymentNotificationListener.class);
            try { requestRebind(c); } catch (Exception ignored) { }
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (connected) return;
                PackageManager pm = app.getPackageManager();
                pm.setComponentEnabledSetting(c, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
                pm.setComponentEnabledSetting(c, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
            }, 3000);
        }, 4000);
    }

    /** Does this text read like a completed money movement (and not an OTP, a due notice or an offer)? */
    /** A block / unblock notice only (used to catch up on those without re-reading ordinary payments). */
    static boolean looksLikeHold(String all) {
        return AMOUNT.matcher(all).find() && HOLD_WORDS.matcher(all).find() && !IGNORE_ALWAYS.matcher(all).find();
    }

    static boolean looksLikePayment(String all) {
        if (!AMOUNT.matcher(all).find()) return false;
        // an IPO / UPI-mandate block or unblock moves no money, but the app tracks it (the frozen amount): keep those, even though they say "mandate"
        if (HOLD_WORDS.matcher(all).find()) return !IGNORE_ALWAYS.matcher(all).find();
        if (NOT_MOVED_UNLESS_DONE.matcher(all).find() && !DONE.matcher(all).find()) return false;
        return MONEY_WORDS.matcher(all).find() && !IGNORE.matcher(all).find();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (sbn.getPackageName().equals(getPackageName()) || sbn.isOngoing()) return;
            Bundle extras = sbn.getNotification().extras;
            if (extras == null) return;
            CharSequence title = extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
            CharSequence text = big != null ? big : extras.getCharSequence(Notification.EXTRA_TEXT);
            if (text == null) return;
            String body = text.toString();
            String all = (title != null ? title + " " : "") + body;
            if (!looksLikePayment(all)) return;
            final String pkg = sbn.getPackageName(), t = title != null ? title.toString() : "";
            final long at = sbn.getPostTime();
            final Context ctx = getApplicationContext();
            IO.execute(() -> {
                try {
                    boolean added = JustMoneyDb.get(ctx).addCaptured(pkg, t, body, at);
                    Callback cb = callback;
                    if (added && cb != null) cb.onCaptured();
                } catch (Exception ignored) { }
            });
        } catch (Exception ignored) {
            // never let a malformed notification crash the listener
        }
    }
}
