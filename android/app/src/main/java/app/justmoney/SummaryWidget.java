package app.justmoney;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.icu.text.NumberFormat;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.HashSet;
import java.util.Set;

/**
 * Home-screen widget: today's personal spending and what's left of the month's
 * spendable money, with Add and Voice buttons. Totals are computed here, straight
 * from the database, so "today" is right even if the app hasn't been opened today.
 * The app writes @WidgetSnapshot (budget, committed categories, currency, privacy)
 * whenever those settings change.
 */
public class SummaryWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        RemoteViews views = build(ctx);
        for (int id : ids) mgr.updateAppWidget(id, views);
    }

    /** Refresh every placed widget (called by the app after data changes). */
    public static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, SummaryWidget.class));
        if (ids.length == 0) return;
        RemoteViews views = build(ctx);
        for (int id : ids) mgr.updateAppWidget(id, views);
    }

    private static RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_summary);
        v.setOnClickPendingIntent(R.id.widget_root, open(ctx, null, 0));
        v.setImageViewBitmap(R.id.widget_icon, WidgetArt.icon(ctx, "trend", 0xE0B39DFF, 16));
        v.setOnClickPendingIntent(R.id.widget_add, open(ctx, "justmoney://add", 1));
        v.setOnClickPendingIntent(R.id.widget_voice, open(ctx, "justmoney://voice", 2));
        WidgetKit.eye(ctx, v, R.id.widget_eye);
        try {
            JustMoneyDb db = JustMoneyDb.get(ctx);
            String raw = db.getItem("@WidgetSnapshot");
            if (raw == null) return v; // app not set up yet: keep the "Open JustMoney" text
            JSONObject snap = new JSONObject(raw);
            if (snap.optBoolean("locked", false)) {
                v.setTextViewText(R.id.widget_today, "••••");
                v.setTextViewText(R.id.widget_left, "App Lock is on — open to see amounts");
                v.setProgressBar(R.id.widget_progress, 100, 0, false);
                return v;
            }
            Set<String> committed = new HashSet<>();
            JSONArray c = snap.optJSONArray("committed");
            if (c != null) for (int i = 0; i < c.length(); i++) committed.add(c.getString(i));
            committed.add("Self transfer");
            committed.add("Loan");

            Calendar cal = Calendar.getInstance();
            cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0); cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0);
            long today = cal.getTimeInMillis();
            cal.set(Calendar.DAY_OF_MONTH, 1);
            long month = cal.getTimeInMillis();

            double todaySpent = 0, monthSpent = 0;
            for (String json : db.getTransactionJsonSince(month)) {
                JSONObject t = new JSONObject(json);
                if (!"DEBIT".equals(t.optString("paymentType")) || committed.contains(t.optString("paymentCategory"))) continue;
                double amt = t.optDouble("paymentAmount", 0);
                monthSpent += amt;
                if (t.optLong("timestamp") >= today) todaySpent += amt;
            }

            NumberFormat fmt = WidgetKit.money(ctx, snap);

            double budget = snap.optDouble("budget", 0);
            v.setTextViewText(R.id.widget_today, fmt.format(todaySpent));
            if (budget > 0) {
                double left = budget - monthSpent;
                String label = snap.optString("budgetLabel", "budget");
                v.setTextViewText(R.id.widget_left, left >= 0
                        ? fmt.format(left) + " left of " + fmt.format(budget) + " " + label
                        : fmt.format(-left) + " over your " + label);
                v.setProgressBar(R.id.widget_progress, 100, (int) Math.min(100, Math.round(monthSpent / budget * 100)), false);
            } else {
                v.setTextViewText(R.id.widget_left, fmt.format(monthSpent) + " spent this month");
                v.setProgressBar(R.id.widget_progress, 100, 0, false);
            }
        } catch (Exception e) {
            v.setTextViewText(R.id.widget_left, "Open JustMoney");
        }
        return v;
    }

    private static PendingIntent open(Context ctx, String uri, int code) {
        Intent i;
        if (uri == null) {
            i = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            if (i == null) i = new Intent(ctx, MainActivity.class);
        } else {
            i = new Intent(Intent.ACTION_VIEW, Uri.parse(uri), ctx, MainActivity.class);
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
