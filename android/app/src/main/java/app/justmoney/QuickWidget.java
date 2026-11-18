package app.justmoney;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

/** Home-screen widget: one-tap Add, Voice, Scan and Split. */
public class QuickWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        RemoteViews views = build(ctx);
        for (int id : ids) mgr.updateAppWidget(id, views);
    }

    static void updateAll(Context ctx) {
        int[] ids = WidgetKit.ids(ctx, QuickWidget.class);
        if (ids.length == 0) return;
        RemoteViews views = build(ctx);
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : ids) mgr.updateAppWidget(id, views);
    }

    private static RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_quick);
        v.setOnClickPendingIntent(R.id.quick_add, WidgetKit.open(ctx, "justmoney://add", 30));
        v.setOnClickPendingIntent(R.id.quick_voice, WidgetKit.open(ctx, "justmoney://voice", 31));
        v.setOnClickPendingIntent(R.id.quick_scan, WidgetKit.open(ctx, "justmoney://scan", 32));
        v.setOnClickPendingIntent(R.id.quick_split, WidgetKit.open(ctx, "justmoney://split", 33));
        return v;
    }
}
