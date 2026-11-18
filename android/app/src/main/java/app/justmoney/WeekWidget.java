package app.justmoney;

import android.content.Context;
import android.icu.text.NumberFormat;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** 4x2: spending on each of the last seven days as a small bar chart. */
public class WeekWidget extends GlassWidget {
    @Override
    RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_week);
        v.setOnClickPendingIntent(R.id.widget_root, WidgetKit.open(ctx, null, 80));
        JSONObject snap = WidgetKit.snapshot(ctx);
        if (snap == null) return v;
        if (WidgetKit.locked(snap)) { v.setTextViewText(R.id.week_total, "••••"); v.setTextViewText(R.id.week_avg, "App Lock is on"); return v; }
        NumberFormat fmt = WidgetKit.money(ctx, snap);
        WidgetKit.Spend s = WidgetKit.spend(ctx, snap);
        double total = 0;
        for (double d : s.week) total += d;
        v.setTextViewText(R.id.week_total, fmt.format(total));
        v.setTextViewText(R.id.week_avg, "about " + fmt.format(total / 7) + " a day");
        v.setImageViewBitmap(R.id.week_chart, WidgetArt.weekBars(ctx, 280, 70, s.week, s.weekLabels));
        return v;
    }
}
