package app.justmoney;

import android.content.Context;
import android.icu.text.NumberFormat;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.Calendar;

/** 2x2: how much of this month's budget is used, as a ring, with what is left per day. */
public class RingWidget extends GlassWidget {
    @Override
    RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_ring);
        v.setOnClickPendingIntent(R.id.widget_root, WidgetKit.open(ctx, null, 40));
        JSONObject snap = WidgetKit.snapshot(ctx);
        if (snap == null) return v;
        if (WidgetKit.locked(snap)) {
            v.setTextViewText(R.id.ring_pct, "••");
            v.setTextViewText(R.id.ring_amt, "App Lock is on");
            return v;
        }
        NumberFormat fmt = WidgetKit.money(ctx, snap);
        double budget = snap.optDouble("budget", 0);
        WidgetKit.Spend s = WidgetKit.spend(ctx, snap);
        if (budget <= 0) {
            v.setImageViewBitmap(R.id.ring_img, WidgetArt.ring(ctx, 84, 0f, WidgetArt.VIOLET, 9));
            v.setTextViewText(R.id.ring_pct, "—");
            v.setTextViewText(R.id.ring_amt, fmt.format(s.month));
            v.setTextViewText(R.id.ring_label, "spent this month");
            return v;
        }
        double frac = s.month / budget;
        boolean over = s.month > budget;
        int color = over ? WidgetKit.RED : (frac > 0.8 ? 0xFFFBBF24 : WidgetArt.VIOLET);
        v.setImageViewBitmap(R.id.ring_img, WidgetArt.ring(ctx, 84, (float) Math.min(1.0, frac), color, 9));
        v.setTextViewText(R.id.ring_pct, Math.round(frac * 100) + "%");
        if (over) {
            v.setTextViewText(R.id.ring_amt, fmt.format(s.month - budget) + " over");
            v.setTextColor(R.id.ring_amt, WidgetKit.RED);
            v.setTextViewText(R.id.ring_label, "of " + fmt.format(budget) + " " + snap.optString("budgetLabel", "budget"));
        } else {
            Calendar cal = Calendar.getInstance();
            int daysLeft = cal.getActualMaximum(Calendar.DAY_OF_MONTH) - cal.get(Calendar.DAY_OF_MONTH) + 1;
            v.setTextViewText(R.id.ring_amt, fmt.format(budget - s.month) + " left");
            v.setTextColor(R.id.ring_amt, WidgetKit.WHITE);
            v.setTextViewText(R.id.ring_label, "about " + fmt.format((budget - s.month) / Math.max(1, daysLeft)) + " / day");
        }
        return v;
    }
}
