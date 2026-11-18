package app.justmoney;

import android.content.Context;
import android.icu.text.NumberFormat;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** 2x2: your closest savings goal as a ring. */
public class GoalWidget extends GlassWidget {
    @Override
    RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_goal);
        v.setOnClickPendingIntent(R.id.widget_root, WidgetKit.open(ctx, null, 70));
        JSONObject snap = WidgetKit.snapshot(ctx);
        v.setImageViewBitmap(R.id.goal_icon, WidgetArt.icon(ctx, "target", 0xFFFFFFFF, 26));
        if (WidgetKit.locked(snap)) { v.setTextViewText(R.id.goal_name, "App Lock is on"); return v; }
        JSONObject g = snap == null ? null : snap.optJSONObject("goal");
        if (g == null) {
            v.setImageViewBitmap(R.id.goal_ring, WidgetArt.ring(ctx, 84, 0f, WidgetArt.VIOLET, 9));
            v.setTextViewText(R.id.goal_name, "No goal yet");
            v.setTextViewText(R.id.goal_amt, "Set one in Planner");
            return v;
        }
        NumberFormat fmt = WidgetKit.money(ctx, snap);
        double saved = g.optDouble("saved"), target = Math.max(1, g.optDouble("target", 1));
        int color = WidgetArt.color(g.optString("color"), WidgetArt.VIOLET);
        v.setImageViewBitmap(R.id.goal_ring, WidgetArt.ring(ctx, 84, (float) (saved / target), color, 9));
        v.setTextViewText(R.id.goal_name, g.optString("name"));
        v.setTextViewText(R.id.goal_amt, fmt.format(saved) + " of " + fmt.format(target));
        v.setTextViewText(R.id.goal_pct, Math.min(100, Math.round(saved / target * 100)) + "% saved");
        return v;
    }
}
