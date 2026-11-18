package app.justmoney;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.graphics.Bitmap;
import android.icu.text.NumberFormat;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Home-screen widget: the latest transactions, paid in red and received in green. */
public class RecentWidget extends AppWidgetProvider {
    private static final int[][] ROWS = {
        {R.id.rec_row1, R.id.rec_name1, R.id.rec_meta1, R.id.rec_amt1, R.id.rec_icon1, R.id.rec_badge1},
        {R.id.rec_row2, R.id.rec_name2, R.id.rec_meta2, R.id.rec_amt2, R.id.rec_icon2, R.id.rec_badge2},
        {R.id.rec_row3, R.id.rec_name3, R.id.rec_meta3, R.id.rec_amt3, R.id.rec_icon3, R.id.rec_badge3},
        {R.id.rec_row4, R.id.rec_name4, R.id.rec_meta4, R.id.rec_amt4, R.id.rec_icon4, R.id.rec_badge4},
    };
    private static final long DAYS_60 = 60L * 24 * 60 * 60 * 1000;

    /** Payment apps we have a logo for; everything else just shows the amount icon. */
    private static final Map<String, Integer> APP_ICONS = new HashMap<>();
    static {
        APP_ICONS.put("PhonePe", R.drawable.widget_app_phonepe);
        APP_ICONS.put("Paytm", R.drawable.widget_app_paytm);
        APP_ICONS.put("BHIM", R.drawable.widget_app_bhim);
        APP_ICONS.put("super.money", R.drawable.widget_app_supermoney);
        APP_ICONS.put("Amazon Pay", R.drawable.widget_app_amazonpay);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        RemoteViews views = build(ctx);
        for (int id : ids) mgr.updateAppWidget(id, views);
    }

    static void updateAll(Context ctx) {
        int[] ids = WidgetKit.ids(ctx, RecentWidget.class);
        if (ids.length == 0) return;
        RemoteViews views = build(ctx);
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : ids) mgr.updateAppWidget(id, views);
    }

    private static RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_recent);
        v.setOnClickPendingIntent(R.id.widget_root, WidgetKit.open(ctx, null, 20));
        v.setOnClickPendingIntent(R.id.rec_add, WidgetKit.open(ctx, "justmoney://add", 21));
        for (int[] row : ROWS) v.setViewVisibility(row[0], View.GONE);
        JSONObject snap = WidgetKit.snapshot(ctx);
        if (WidgetKit.locked(snap)) {
            v.setViewVisibility(R.id.rec_empty, View.VISIBLE);
            v.setTextViewText(R.id.rec_empty, "App Lock is on. Open to see transactions");
            return v;
        }
        try {
            NumberFormat fmt = WidgetKit.money(ctx, snap);
            List<JSONObject> txns = WidgetKit.transactionsSince(ctx, System.currentTimeMillis() - DAYS_60);
            v.setViewVisibility(R.id.rec_empty, txns.isEmpty() ? View.VISIBLE : View.GONE);
            if (txns.isEmpty()) v.setTextViewText(R.id.rec_empty, "No transactions yet");
            for (int i = 0; i < ROWS.length && i < txns.size(); i++) {
                JSONObject t = txns.get(i);
                boolean credit = "CREDIT".equals(t.optString("paymentType"));
                int[] r = ROWS[i];
                // the merchant's logo if we have it, otherwise its category icon in the category's colour
                String payee = t.optString("paymentReceiver", "Transaction");
                String cat = t.optString("paymentCategory");
                Bitmap base = WidgetArt.logo(ctx, WidgetArt.brandKey(snap, payee), 28);
                if (base == null && !credit) base = WidgetArt.iconBadge(ctx, WidgetArt.categoryIcon(snap, cat), WidgetArt.categoryColor(snap, cat), 28);
                if (base == null) base = WidgetArt.letter(ctx, payee, 0xFF30D158, 28);
                v.setViewVisibility(r[0], View.VISIBLE);
                v.setTextViewText(r[1], t.optString("paymentReceiver", "Transaction"));
                v.setTextViewText(r[2], t.optString("paymentCategory") + " · " + when(t.optLong("timestamp"), t.optBoolean("timeUnknown", false)));
                v.setTextViewText(r[3], (credit ? "+" : "") + fmt.format(t.optDouble("paymentAmount", 0)));
                v.setTextColor(r[3], credit ? WidgetKit.GREEN : WidgetKit.WHITE);
                v.setImageViewBitmap(r[4], base);
                v.setViewVisibility(r[5], View.GONE);
            }
        } catch (Exception e) {
            v.setViewVisibility(R.id.rec_empty, View.VISIBLE);
            v.setTextViewText(R.id.rec_empty, "Open JustMoney");
        }
        return v;
    }

    /** "Today 2:30 PM", "Yesterday", or "Oct 21". */
    private static String when(long ts, boolean dateOnly) {
        Calendar now = Calendar.getInstance();
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ts);
        boolean sameYear = now.get(Calendar.YEAR) == c.get(Calendar.YEAR);
        int dayDiff = now.get(Calendar.DAY_OF_YEAR) - c.get(Calendar.DAY_OF_YEAR);
        String time = dateOnly ? "" : " " + new SimpleDateFormat("h:mm a", Locale.ENGLISH).format(new Date(ts));
        if (sameYear && dayDiff == 0) return "Today" + time;
        if (sameYear && dayDiff == 1) return "Yesterday" + time;
        return new SimpleDateFormat("MMM d", Locale.ENGLISH).format(new Date(ts));
    }
}
