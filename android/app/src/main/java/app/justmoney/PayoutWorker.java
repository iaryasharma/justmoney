package app.justmoney;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Settles PhonePe and Paytm business sales at the time the user chose, even when JustMoney is closed.
 * It does what the app does when it is open (merchant.ts settleSales): from the day after a sale, if no bank message paid it out and
 * the user did not say "not yet", the sales are marked paid out and the payout is recorded in the shop's bank account.
 */
public final class PayoutWorker extends Worker {
    private static final String WORK_NAME = "justmoney-shop-payouts";
    private static final String CHANNEL = "shop_payouts";

    public PayoutWorker(@NonNull Context ctx, @NonNull WorkerParameters params) {
        super(ctx, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            settleIfDue(getApplicationContext(), System.currentTimeMillis());
        } catch (Exception ignored) {
            // a failed check must never loop: the next run tries again
        }
        return Result.success();
    }

    /** Runs about every fifteen minutes (the shortest Android allows). Safe to call on every launch. */
    public static void schedule(Context ctx) {
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(PayoutWorker.class, 15, TimeUnit.MINUTES).build();
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, req);
    }

    private static JSONObject obj(String raw) {
        try { return raw == null ? null : new JSONObject(raw); } catch (Exception e) { return null; }
    }

    /** Package-private so it can be tested without WorkManager. Returns how many sales were settled. */
    static int settleIfDue(Context ctx, long now) throws Exception {
        JustMoneyDb db = JustMoneyDb.get(ctx);
        // the app is open and does this itself (it writes a heartbeat every minute while visible)
        String beat = db.getItem("@AppHeartbeat");
        if (beat != null) {
            try { if (now - Long.parseLong(beat.trim()) < 3 * 60000L) return 0; } catch (NumberFormatException ignored) { }
        }
        JSONObject set = obj(db.getItem("@MerchantSettings"));
        boolean auto = set == null || set.optBoolean("auto", true);
        if (!auto) return 0;
        String time = set == null ? "10:00" : set.optString("time", "10:00");
        String accountId = set != null && !set.isNull("accountId") ? set.optString("accountId", "") : "";

        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(now);
        cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0); cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0);
        long startOfToday = cal.getTimeInMillis();
        String[] hm = time.split(":");
        int h = 10, m = 0;
        try { h = Integer.parseInt(hm[0]); m = hm.length > 1 ? Integer.parseInt(hm[1]) : 0; } catch (NumberFormatException ignored) { }
        long autoAt = startOfToday + h * 3600000L + m * 60000L;
        if (now < autoAt) return 0;

        String sn = db.getItem("@SettleSnooze");
        if (sn != null) {
            try { if (Long.parseLong(sn.trim()) > now) return 0; } catch (NumberFormatException ignored) { }
        }

        // sales from earlier days, still with the app: no bank account, not paid out
        Map<String, List<JSONObject>> groups = new LinkedHashMap<>();
        for (String json : db.getTransactionJsonSince(now - 45L * 86400000L)) {
            JSONObject t = obj(json);
            if (t == null) continue;
            String app = t.optString("paymentApp", "");
            boolean shopApp = app.equals("PhonePe Business") || app.equals("Paytm Business");
            if (!shopApp || !"CREDIT".equals(t.optString("paymentType")) || t.optLong("timestamp") >= startOfToday) continue;
            if (t.has("settledBy") && !t.isNull("settledBy")) continue;
            if (t.has("paymentMethodId") && !t.isNull("paymentMethodId") && !t.optString("paymentMethodId").isEmpty()) continue;
            if (!groups.containsKey(app)) groups.put(app, new ArrayList<>());
            groups.get(app).add(t);
        }
        if (groups.isEmpty()) return 0;

        List<JustMoneyDb.TxRow> upserts = new ArrayList<>();
        double grand = 0;
        int count = 0;
        int n = 0;
        for (Map.Entry<String, List<JSONObject>> e : groups.entrySet()) {
            String id = "payout_" + Long.toString(now, 36) + "_" + n++;
            double total = 0;
            JSONArray ids = new JSONArray();
            for (JSONObject s : e.getValue()) {
                total += s.optDouble("paymentAmount");
                ids.put(s.optString("id"));
                s.put("settledBy", id);
                s.put("updatedAt", now);
                upserts.add(new JustMoneyDb.TxRow(s.optString("id"), s.optLong("timestamp"), s.toString()));
            }
            total = Math.round(total * 100.0) / 100.0;
            JSONObject p = new JSONObject();
            p.put("id", id);
            p.put("timestamp", now);
            p.put("paymentAmount", total);
            p.put("paymentType", "CREDIT");
            p.put("paymentReceiver", e.getKey().replace(" Business", "") + " payout");
            p.put("paymentCategory", "Self transfer");
            if (!accountId.isEmpty()) { p.put("paymentMethodId", accountId); p.put("paymentSource", "BANK"); }
            p.put("paymentApp", e.getKey());
            p.put("settlesIds", ids);
            p.put("autoPayout", true);
            p.put("note", "Payout of " + e.getValue().size() + (e.getValue().size() == 1 ? " sale" : " sales") + " · settled automatically");
            p.put("createdAt", now);
            p.put("updatedAt", now);
            upserts.add(new JustMoneyDb.TxRow(id, now, p.toString()));
            grand += total;
            count += e.getValue().size();
        }
        db.applyTransactionChanges(upserts, new ArrayList<>());
        try { WidgetKit.updateAll(ctx); } catch (Exception ignored) { }
        notifyUser(ctx, grand, count, !accountId.isEmpty());
        return count;
    }

    private static void notifyUser(Context ctx, double total, int count, boolean credited) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Shop payouts", NotificationManager.IMPORTANCE_DEFAULT));
            String text = String.format(Locale.US, "₹%,.0f from %d sale%s marked settled%s. Open JustMoney to undo if it has not arrived.", total, count, count == 1 ? "" : "s", credited ? " and added to your bank" : "");
            nm.notify(7311, new NotificationCompat.Builder(ctx, CHANNEL)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle("Shop payout settled")
                    .setContentText(text)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                    .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                    .setAutoCancel(true)
                    .build());
        } catch (Exception ignored) { }
    }
}
