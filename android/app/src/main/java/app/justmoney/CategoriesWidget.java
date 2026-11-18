package app.justmoney;

import android.content.Context;
import android.icu.text.NumberFormat;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** 4x2: the three categories you spent most on this month, with icons and bars. */
public class CategoriesWidget extends GlassWidget {
    private static final int[][] ROWS = {
        {R.id.cat_row1, R.id.cat_icon1, R.id.cat_name1, R.id.cat_amt1, R.id.cat_bar1},
        {R.id.cat_row2, R.id.cat_icon2, R.id.cat_name2, R.id.cat_amt2, R.id.cat_bar2},
        {R.id.cat_row3, R.id.cat_icon3, R.id.cat_name3, R.id.cat_amt3, R.id.cat_bar3},
    };

    @Override
    RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_categories);
        v.setOnClickPendingIntent(R.id.widget_root, WidgetKit.open(ctx, null, 50));
        for (int[] r : ROWS) v.setViewVisibility(r[0], View.GONE);
        JSONObject snap = WidgetKit.snapshot(ctx);
        if (snap == null) { v.setViewVisibility(R.id.cat_empty, View.VISIBLE); return v; }
        if (WidgetKit.locked(snap)) { v.setViewVisibility(R.id.cat_empty, View.VISIBLE); v.setTextViewText(R.id.cat_empty, "App Lock is on. Open to see spending"); return v; }
        NumberFormat fmt = WidgetKit.money(ctx, snap);
        WidgetKit.Spend s = WidgetKit.spend(ctx, snap);
        List<Map.Entry<String, Double>> top = new ArrayList<>(s.cats.entrySet());
        top.sort((a, b) -> Double.compare(b.getValue(), a.getValue()));
        v.setViewVisibility(R.id.cat_empty, top.isEmpty() ? View.VISIBLE : View.GONE);
        double max = top.isEmpty() ? 1 : top.get(0).getValue();
        for (int i = 0; i < ROWS.length && i < top.size(); i++) {
            String cat = top.get(i).getKey();
            int color = WidgetArt.categoryColor(snap, cat);
            int[] r = ROWS[i];
            v.setViewVisibility(r[0], View.VISIBLE);
            v.setImageViewBitmap(r[1], WidgetArt.iconBadge(ctx, WidgetArt.categoryIcon(snap, cat), color, 28));
            v.setTextViewText(r[2], cat + "  " + Math.round(top.get(i).getValue() / Math.max(1, s.month) * 100) + "%");
            v.setTextViewText(r[3], fmt.format(top.get(i).getValue()));
            v.setImageViewBitmap(r[4], WidgetArt.bar(ctx, 220, 6, (float) (top.get(i).getValue() / max), color));
        }
        return v;
    }
}
