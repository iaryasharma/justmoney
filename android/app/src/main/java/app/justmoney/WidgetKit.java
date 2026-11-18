package app.justmoney;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.icu.text.NumberFormat;
import android.icu.util.Currency;
import android.icu.util.ULocale;
import android.net.Uri;
import android.widget.RemoteViews;

import java.text.FieldPosition;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Shared bits for the home-screen widgets: the app's @WidgetSnapshot, money
 * formatting, deep-link taps, and refreshing every widget after data changes.
 */
final class WidgetKit {
    private WidgetKit() {}

    static final int RED = 0xFFFF453A;
    static final int GREEN = 0xFF30D158;
    static final int WHITE = 0xFFFFFFFF;

    /** The snapshot the app writes (budget, accounts, currency, App Lock), or null before setup. */
    static JSONObject snapshot(Context ctx) {
        try {
            String raw = JustMoneyDb.get(ctx).getItem("@WidgetSnapshot");
            return raw == null ? null : new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }

    static boolean locked(JSONObject snap) {
        return snap != null && snap.optBoolean("locked", false);
    }

    static final String TOGGLE_HIDE = "app.justmoney.WIDGET_TOGGLE_HIDE";
    private static final String PREFS = "justmoney_widgets";

    /** Amounts hidden on every widget (the eye on the balance and today widgets). Widget-only, not the app's own setting. */
    static boolean hidden(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("hidden", false);
    }

    static void toggleHidden(Context ctx) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("hidden", !hidden(ctx)).apply();
        updateAll(ctx);
    }

    /** Wires an eye button: shows the current state and flips it on tap (handled by BalanceWidget.onReceive). */
    static void eye(Context ctx, RemoteViews v, int viewId) {
        boolean h = hidden(ctx);
        v.setImageViewResource(viewId, h ? R.drawable.ic_w_eye_off : R.drawable.ic_w_eye);
        v.setContentDescription(viewId, h ? "Show amounts" : "Hide amounts");
        Intent i = new Intent(ctx, BalanceWidget.class).setAction(TOGGLE_HIDE);
        v.setOnClickPendingIntent(viewId, PendingIntent.getBroadcast(ctx, 90, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
    }

    static NumberFormat money(Context ctx, JSONObject snap) {
        String locale = snap == null ? "en_IN" : snap.optString("locale", "en_IN");
        String currency = snap == null ? "INR" : snap.optString("currency", "INR");
        NumberFormat fmt = NumberFormat.getCurrencyInstance(new ULocale(locale));
        // a missing or odd currency code ("null") falls back to rupees instead of crashing the widget
        try { fmt.setCurrency(Currency.getInstance(currency)); } catch (Exception e) { fmt.setCurrency(Currency.getInstance("INR")); }
        fmt.setMaximumFractionDigits(0);
        if (!hidden(ctx)) return fmt;
        return new Masked(fmt.getCurrency().getSymbol(new ULocale(locale)) + "••••");
    }

    /** Formats every number as "₹••••", so each widget hides amounts without its own code. */
    static final class Masked extends android.icu.text.DecimalFormat {
        private final String mask;
        Masked(String mask) { this.mask = mask; }
        @Override public StringBuffer format(double n, StringBuffer to, FieldPosition pos) { return to.append(mask); }
        @Override public StringBuffer format(long n, StringBuffer to, FieldPosition pos) { return to.append(mask); }
    }

    /** Transactions since `since`, newest first. */
    static List<JSONObject> transactionsSince(Context ctx, long since) {
        List<JSONObject> out = new ArrayList<>();
        for (String json : JustMoneyDb.get(ctx).getTransactionJsonSince(since)) {
            try { out.add(new JSONObject(json)); } catch (Exception ignored) { }
        }
        out.sort((a, b) -> Long.compare(b.optLong("timestamp"), a.optLong("timestamp")));
        return out;
    }

    /** What was spent today / this month / by category / on each of the last 7 days (personal spending only). */
    static final class Spend {
        double today, month;
        final Map<String, Double> cats = new LinkedHashMap<>();
        final double[] week = new double[7];
        final String[] weekLabels = new String[7];
    }

    static Spend spend(Context ctx, JSONObject snap) {
        Spend out = new Spend();
        Set<String> committed = new HashSet<>();
        JSONArray c = snap == null ? null : snap.optJSONArray("committed");
        if (c != null) for (int i = 0; i < c.length(); i++) committed.add(c.optString(i));
        committed.add("Self transfer");
        committed.add("Loan");
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0); cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0);
        long today = cal.getTimeInMillis();
        Calendar wk = (Calendar) cal.clone();
        wk.add(Calendar.DAY_OF_MONTH, -6);
        long weekStart = wk.getTimeInMillis();
        String[] names = {"S", "M", "T", "W", "T", "F", "S"};
        for (int i = 0; i < 7; i++) {
            Calendar d = (Calendar) wk.clone();
            d.add(Calendar.DAY_OF_MONTH, i);
            out.weekLabels[i] = names[d.get(Calendar.DAY_OF_WEEK) - 1];
        }
        cal.set(Calendar.DAY_OF_MONTH, 1);
        long month = cal.getTimeInMillis();
        try {
            for (JSONObject t : transactionsSince(ctx, Math.min(month, weekStart))) {
                if (!"DEBIT".equals(t.optString("paymentType")) || committed.contains(t.optString("paymentCategory"))) continue;
                double amt = t.optDouble("paymentAmount", 0);
                long ts = t.optLong("timestamp");
                if (ts >= month) {
                    out.month += amt;
                    out.cats.merge(t.optString("paymentCategory", "Others"), amt, Double::sum);
                }
                if (ts >= today) out.today += amt;
                if (ts >= weekStart) {
                    Calendar d = Calendar.getInstance();
                    d.setTimeInMillis(ts);
                    d.set(Calendar.HOUR_OF_DAY, 0); d.set(Calendar.MINUTE, 0); d.set(Calendar.SECOND, 0); d.set(Calendar.MILLISECOND, 0);
                    int idx = (int) Math.round((d.getTimeInMillis() - weekStart) / 86400000.0);
                    if (idx >= 0 && idx < 7) out.week[idx] += amt;
                }
            }
        } catch (Exception ignored) { }
        return out;
    }

    /** Opens the app, or a justmoney:// route inside it. */
    static PendingIntent open(Context ctx, String uri, int code) {
        Intent i;
        if (uri == null) {
            i = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            if (i == null) i = new Intent(ctx, MainActivity.class);
        } else {
            i = new Intent(Intent.ACTION_VIEW, Uri.parse(uri), ctx, MainActivity.class);
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static int[] ids(Context ctx, Class<?> provider) {
        return AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, provider));
    }

    /** Refresh every placed JustMoney widget (called by the app after data changes). */
    static void updateAll(Context ctx) {
        SummaryWidget.updateAll(ctx);
        BalanceWidget.updateAll(ctx);
        RecentWidget.updateAll(ctx);
        QuickWidget.updateAll(ctx);
        GlassWidget.refresh(ctx, RingWidget.class);
        GlassWidget.refresh(ctx, CategoriesWidget.class);
        GlassWidget.refresh(ctx, BillsWidget.class);
        GlassWidget.refresh(ctx, GoalWidget.class);
        GlassWidget.refresh(ctx, WeekWidget.class);
    }
}
