package app.justmoney;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

/** Shared plumbing for the newer widgets: build the views once, push them to every placed copy. */
abstract class GlassWidget extends AppWidgetProvider {
    abstract RemoteViews build(Context ctx);

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        // bad snapshot data must leave the widget as it was, not crash the app's process
        try {
            RemoteViews v = build(ctx);
            for (int id : ids) mgr.updateAppWidget(id, v);
        } catch (Exception ignored) { }
    }

    /** Re-draw every placed copy of `cls` (called after the app's data changes). */
    static void refresh(Context ctx, Class<? extends GlassWidget> cls) {
        try {
            int[] ids = WidgetKit.ids(ctx, cls);
            if (ids.length == 0) return;
            RemoteViews v = cls.getDeclaredConstructor().newInstance().build(ctx);
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            for (int id : ids) mgr.updateAppWidget(id, v);
        } catch (Exception ignored) { }
    }
}
