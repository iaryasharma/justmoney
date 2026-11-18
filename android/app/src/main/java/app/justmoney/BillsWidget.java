package app.justmoney;

import android.content.Context;
import android.graphics.Bitmap;
import android.icu.text.NumberFormat;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/** 4x2: what is due in the next few weeks (EMIs, subscriptions, loans), with logos. */
public class BillsWidget extends GlassWidget {
    private static final int[][] ROWS = {
        {R.id.bill_row1, R.id.bill_icon1, R.id.bill_name1, R.id.bill_due1, R.id.bill_amt1},
        {R.id.bill_row2, R.id.bill_icon2, R.id.bill_name2, R.id.bill_due2, R.id.bill_amt2},
        {R.id.bill_row3, R.id.bill_icon3, R.id.bill_name3, R.id.bill_due3, R.id.bill_amt3},
    };

    @Override
    RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_bills);
        v.setOnClickPendingIntent(R.id.widget_root, WidgetKit.open(ctx, null, 60));
        for (int[] r : ROWS) v.setViewVisibility(r[0], View.GONE);
        JSONObject snap = WidgetKit.snapshot(ctx);
        if (WidgetKit.locked(snap)) { v.setViewVisibility(R.id.bill_empty, View.VISIBLE); v.setTextViewText(R.id.bill_empty, "App Lock is on. Open to see bills"); return v; }
        JSONArray bills = snap == null ? null : snap.optJSONArray("bills");
        int shown = 0;
        if (bills != null) {
            NumberFormat fmt = WidgetKit.money(ctx, snap);
            for (int i = 0; i < bills.length() && shown < ROWS.length; i++) {
                JSONObject b = bills.optJSONObject(i);
                if (b == null) continue;
                long due = b.optLong("dueAt");
                if (due < startOfToday()) continue; // already past
                int[] r = ROWS[shown++];
                v.setViewVisibility(r[0], View.VISIBLE);
                Bitmap logo = WidgetArt.logo(ctx, b.optString("logo", ""), 28);
                String kind = b.optString("kind");
                v.setImageViewBitmap(r[1], logo != null ? logo : WidgetArt.iconBadge(ctx, "emi".equals(kind) ? "card" : "loan".equals(kind) ? "users" : "repeat", WidgetArt.VIOLET, 28));
                v.setTextViewText(r[2], b.optString("name"));
                v.setTextViewText(r[3], dueText(due));
                v.setTextViewText(r[4], fmt.format(b.optDouble("amount", 0)));
            }
        }
        v.setViewVisibility(R.id.bill_empty, shown == 0 ? View.VISIBLE : View.GONE);
        return v;
    }

    private static long startOfToday() {
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    private static String dueText(long due) {
        long days = Math.round((due - startOfToday()) / 86400000.0);
        if (days <= 0) return "Due today";
        if (days == 1) return "Tomorrow";
        return "In " + days + " days";
    }
}
