package app.justmoney;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.icu.text.NumberFormat;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Home-screen widget: total bank balance and up to three accounts. Each balance is
 * the opening balance the user set plus money in minus money out since then, for
 * the account and the debit cards that spend from it, read straight from the database.
 */
public class BalanceWidget extends AppWidgetProvider {
    private static final int[][] ROWS = {
        {R.id.bal_row1, R.id.bal_name1, R.id.bal_amt1, R.id.bal_logo1},
        {R.id.bal_row2, R.id.bal_name2, R.id.bal_amt2, R.id.bal_logo2},
        {R.id.bal_row3, R.id.bal_name3, R.id.bal_amt3, R.id.bal_logo3},
    };

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (WidgetKit.TOGGLE_HIDE.equals(intent.getAction())) { WidgetKit.toggleHidden(ctx); return; }
        super.onReceive(ctx, intent);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        RemoteViews views = build(ctx);
        for (int id : ids) mgr.updateAppWidget(id, views);
    }

    static void updateAll(Context ctx) {
        int[] ids = WidgetKit.ids(ctx, BalanceWidget.class);
        if (ids.length == 0) return;
        RemoteViews views = build(ctx);
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : ids) mgr.updateAppWidget(id, views);
    }

    private static RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_balance);
        v.setOnClickPendingIntent(R.id.widget_root, WidgetKit.open(ctx, null, 10));
        for (int[] row : ROWS) v.setViewVisibility(row[0], View.GONE);
        WidgetKit.eye(ctx, v, R.id.bal_eye);
        JSONObject snap = WidgetKit.snapshot(ctx);
        JSONArray accounts = snap == null ? null : snap.optJSONArray("accounts");
        if (accounts == null || accounts.length() == 0) {
            v.setTextViewText(R.id.bal_total, "--");
            v.setTextViewText(R.id.bal_note, "Set a balance in Accounts & cards");
            return v;
        }
        if (WidgetKit.locked(snap)) {
            v.setTextViewText(R.id.bal_total, "••••");
            v.setTextViewText(R.id.bal_note, "App Lock is on. Open to see balances");
            return v;
        }
        try {
            NumberFormat fmt = WidgetKit.money(ctx, snap);
            long earliest = Long.MAX_VALUE;
            for (int i = 0; i < accounts.length(); i++) earliest = Math.min(earliest, accounts.getJSONObject(i).optLong("from", 0));
            List<JSONObject> txns = WidgetKit.transactionsSince(ctx, earliest == Long.MAX_VALUE ? 0 : earliest);
            double total = 0;
            for (int i = 0; i < accounts.length(); i++) {
                JSONObject a = accounts.getJSONObject(i);
                Set<String> ids = new HashSet<>();
                JSONArray idArr = a.optJSONArray("ids");
                if (idArr != null) for (int k = 0; k < idArr.length(); k++) ids.add(idArr.getString(k));
                long from = a.optLong("from", 0);
                double bal = a.optDouble("opening", 0);
                for (JSONObject t : txns) {
                    if (t.optLong("timestamp") < from || !ids.contains(t.optString("paymentMethodId"))) continue;
                    double amt = t.optDouble("paymentAmount", 0);
                    bal += "CREDIT".equals(t.optString("paymentType")) ? amt : -amt;
                }
                total += bal;
                if (i < ROWS.length) {
                    v.setViewVisibility(ROWS[i][0], View.VISIBLE);
                    v.setTextViewText(ROWS[i][1], a.optString("name"));
                    Bitmap logo = WidgetArt.logo(ctx, a.optString("logo", ""), 20);
                    v.setImageViewBitmap(ROWS[i][3], logo != null ? logo : WidgetArt.iconBadge(ctx, a.optString("icon", "bank"), WidgetArt.VIOLET, 20));
                    v.setTextViewText(ROWS[i][2], fmt.format(bal));
                    v.setTextColor(ROWS[i][2], bal < 0 && !WidgetKit.hidden(ctx) ? WidgetKit.RED : WidgetKit.WHITE);
                }
            }
            v.setTextViewText(R.id.bal_total, fmt.format(total));
            v.setTextViewText(R.id.bal_note, accounts.length() == 1 ? "1 account" : accounts.length() + " accounts");
        } catch (Exception e) {
            v.setTextViewText(R.id.bal_note, "Open JustMoney");
        }
        return v;
    }
}
