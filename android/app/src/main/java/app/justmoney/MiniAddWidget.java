package app.justmoney;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

/** 1x1: a single round + button that opens the add-expense sheet. */
public class MiniAddWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_mini);
        v.setOnClickPendingIntent(R.id.mini_add, WidgetKit.open(ctx, "justmoney://add", 90));
        for (int id : ids) mgr.updateAppWidget(id, v);
    }
}
