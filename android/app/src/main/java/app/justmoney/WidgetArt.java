package app.justmoney;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.util.LruCache;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.util.regex.Pattern;

/**
 * Pictures for the home-screen widgets: merchant logos from the app's own assets, round icon
 * badges, progress rings and little bar charts. RemoteViews can only show bitmaps and resources,
 * so everything is drawn here.
 */
final class WidgetArt {
    private WidgetArt() {}

    static final int VIOLET = 0xFF8B5CF6;
    static final int VIOLET_LIGHT = 0xFFC4B5FD;
    static final int MINT = 0xFF34D399;
    static final int TRACK = 0x33FFFFFF;

    private static final LruCache<String, Bitmap> CACHE = new LruCache<>(48);

    static int px(Context ctx, float dp) {
        return Math.max(1, Math.round(dp * ctx.getResources().getDisplayMetrics().density));
    }

    static int color(String hex, int fallback) {
        try { return Color.parseColor(hex); } catch (Exception e) { return fallback; }
    }

    private static Bitmap cached(String key) { return CACHE.get(key); }

    /** A merchant / bank / app logo as a circle, or null if we have no file for it. */
    static Bitmap logo(Context ctx, String key, float sizeDp) {
        if (key == null || key.isEmpty()) return null;
        int size = px(ctx, sizeDp);
        String ck = "logo:" + key + ":" + size;
        Bitmap hit = cached(ck);
        if (hit != null) return hit;
        try (InputStream in = ctx.getAssets().open("public/brands/" + key + ".webp")) {
            Bitmap src = BitmapFactory.decodeStream(in);
            if (src == null) return null;
            Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(out);
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
            Bitmap scaled = Bitmap.createScaledBitmap(src, size, size, true);
            p.setShader(new BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
            c.drawCircle(size / 2f, size / 2f, size / 2f, p);
            CACHE.put(ck, out);
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    /** A solid circle with a white line icon from the app's icon set (res/drawable/ic_c_*). */
    static Bitmap iconBadge(Context ctx, String icon, int bg, float sizeDp) {
        int size = px(ctx, sizeDp);
        String ck = "badge:" + icon + ":" + bg + ":" + size;
        Bitmap hit = cached(ck);
        if (hit != null) return hit;
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(out);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(bg);
        c.drawCircle(size / 2f, size / 2f, size / 2f, p);
        drawIcon(ctx, c, icon, size, 0.54f);
        CACHE.put(ck, out);
        return out;
    }

    /** Just the white icon, centred, at `fraction` of the canvas. */
    static void drawIcon(Context ctx, Canvas c, String icon, int size, float fraction) {
        int id = ctx.getResources().getIdentifier("ic_c_" + (icon == null ? "tag" : icon), "drawable", ctx.getPackageName());
        if (id == 0) id = ctx.getResources().getIdentifier("ic_c_tag", "drawable", ctx.getPackageName());
        Drawable d = id == 0 ? null : ctx.getDrawable(id);
        if (d == null) return;
        int s = Math.round(size * fraction);
        int o = (size - s) / 2;
        d.setBounds(o, o, o + s, o + s);
        d.draw(c);
    }

    /** A bare icon on a transparent background (for tiny glyphs next to labels). */
    static Bitmap icon(Context ctx, String icon, int tint, float sizeDp) {
        int size = px(ctx, sizeDp);
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(out);
        int id = ctx.getResources().getIdentifier("ic_c_" + icon, "drawable", ctx.getPackageName());
        Drawable d = id == 0 ? null : ctx.getDrawable(id);
        if (d != null) { d = d.mutate(); d.setTint(tint); d.setBounds(0, 0, size, size); d.draw(c); }
        return out;
    }

    /** A solid circle with the payee's first letter. */
    static Bitmap letter(Context ctx, String text, int bg, float sizeDp) {
        int size = px(ctx, sizeDp);
        String ch = (text == null || text.trim().isEmpty()) ? "?" : text.trim().substring(0, 1).toUpperCase();
        String ck = "letter:" + ch + ":" + bg + ":" + size;
        Bitmap hit = cached(ck);
        if (hit != null) return hit;
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(out);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(bg);
        c.drawCircle(size / 2f, size / 2f, size / 2f, p);
        p.setColor(Color.WHITE);
        p.setTypeface(Typeface.DEFAULT_BOLD);
        p.setTextSize(size * 0.46f);
        p.setTextAlign(Paint.Align.CENTER);
        c.drawText(ch, size / 2f, size / 2f - (p.descent() + p.ascent()) / 2f, p);
        CACHE.put(ck, out);
        return out;
    }

    /** A progress ring: a faint track and a coloured arc starting at the top. */
    static Bitmap ring(Context ctx, float sizeDp, float fraction, int color, float strokeDp) {
        int size = px(ctx, sizeDp);
        float stroke = px(ctx, strokeDp);
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(out);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(stroke);
        p.setStrokeCap(Paint.Cap.ROUND);
        RectF r = new RectF(stroke / 2f, stroke / 2f, size - stroke / 2f, size - stroke / 2f);
        p.setColor(TRACK);
        c.drawArc(r, 0, 360, false, p);
        float f = Math.max(0f, Math.min(1f, fraction));
        if (f > 0.004f) {
            p.setColor(color);
            c.drawArc(r, -90, 360f * f, false, p);
        }
        return out;
    }

    /** A thin rounded progress bar. */
    static Bitmap bar(Context ctx, float wDp, float hDp, float fraction, int color) {
        int w = px(ctx, wDp), h = px(ctx, hDp);
        Bitmap out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(out);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(TRACK);
        c.drawRoundRect(new RectF(0, 0, w, h), h / 2f, h / 2f, p);
        float f = Math.max(0f, Math.min(1f, fraction));
        if (f > 0.01f) {
            p.setColor(color);
            c.drawRoundRect(new RectF(0, 0, Math.max(h, w * f), h), h / 2f, h / 2f, p);
        }
        return out;
    }

    /** Seven day bars (oldest to newest); the last bar (today) is highlighted. */
    static Bitmap weekBars(Context ctx, float wDp, float hDp, double[] values, String[] labels) {
        int w = px(ctx, wDp), h = px(ctx, hDp);
        Bitmap out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(out);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        double max = 1;
        for (double v : values) max = Math.max(max, v);
        float labelH = px(ctx, 14);
        float chartH = h - labelH;
        float slot = w / (float) values.length;
        float barW = slot * 0.46f;
        p.setTextSize(px(ctx, 10));
        p.setTextAlign(Paint.Align.CENTER);
        for (int i = 0; i < values.length; i++) {
            float cx = slot * i + slot / 2f;
            float bh = values[i] <= 0 ? px(ctx, 3) : (float) Math.max(px(ctx, 5), values[i] / max * (chartH - px(ctx, 4)));
            boolean today = i == values.length - 1;
            p.setColor(today ? VIOLET_LIGHT : (values[i] <= 0 ? 0x22FFFFFF : 0x99A78BFA));
            c.drawRoundRect(new RectF(cx - barW / 2f, chartH - bh, cx + barW / 2f, chartH), barW / 2.4f, barW / 2.4f, p);
            p.setColor(today ? 0xFFFFFFFF : 0x99FFFFFF);
            c.drawText(labels[i], cx, h - px(ctx, 2), p);
        }
        return out;
    }

    /** The logo file key for a payee: the first brand rule in the snapshot that matches its name. */
    static String brandKey(JSONObject snap, String payee) {
        if (snap == null || payee == null) return null;
        JSONArray rules = snap.optJSONArray("brands");
        if (rules == null) return null;
        for (int i = 0; i < rules.length(); i++) {
            JSONObject r = rules.optJSONObject(i);
            if (r == null) continue;
            try {
                int flags = r.optString("flags", "").contains("i") ? Pattern.CASE_INSENSITIVE : 0;
                if (Pattern.compile(r.optString("re"), flags).matcher(payee).find()) return r.optString("key");
            } catch (Exception ignored) { }
        }
        return null;
    }

    /** A category's colour and icon name from the snapshot. */
    static int categoryColor(JSONObject snap, String cat) {
        JSONObject c = snap == null || snap.optJSONObject("categories") == null ? null : snap.optJSONObject("categories").optJSONObject(cat);
        return c == null ? 0xFF8E8E93 : color(c.optString("color"), 0xFF8E8E93);
    }

    static String categoryIcon(JSONObject snap, String cat) {
        JSONObject c = snap == null || snap.optJSONObject("categories") == null ? null : snap.optJSONObject("categories").optJSONObject(cat);
        return c == null ? "tag" : c.optString("icon", "tag");
    }
}
