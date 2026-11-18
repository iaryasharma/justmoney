package app.justmoney;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

/**
 * Writes the database to Documents/JustMoney/justmoney-backup.json, replacing
 * the previous copy. Public Documents survives uninstalling the app, so the
 * file can be restored after a reinstall.
 *
 * Format (version 3): { app, version, exportedAt, transactions: [...], kv: { "@Key": value } }
 */
public final class BackupWriter {
    public static final String DIR = "JustMoney";
    public static final String FILE = "justmoney-backup.json";
    private static final String PREFS = "justmoney_backup";
    private static final long DAY_MS = 24L * 60 * 60 * 1000;

    /** Keys never written to the public backup file: secrets, caches and per-install state. */
    private static final Set<String> EXCLUDED = new HashSet<>(Arrays.asList(
            "@PaymentTransactions", "@GeminiApiKey", "@AppLockEnabled", "@FxRates", "@SpendingInsightsCache",
            "@NotificationsFired", "@AutoBackup", "@InstalledAt", "@DailyTransactionCount",
            "@MigratedFromLocalStorage", "@OnboardingCompleted", "@AppLockBiometric", "@LockFails", "@TwelveDataKey", "@AppHeartbeat",
            "@SettleSnooze", "@CaptureLog", "@SmsRescanHolds", "@WidgetSnapshot", "@PriceCache", "@AdviceCache", "@ErrorLog", "@BackupExcluded", "@Session", "@LastExport"));

    private BackupWriter() {}

    public static SharedPreferences prefs(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!p.contains("installedAt")) p.edit().putLong("installedAt", System.currentTimeMillis()).apply();
        return p;
    }

    public static boolean isEnabled(Context ctx) {
        return prefs(ctx).getBoolean("enabled", true);
    }

    public static void setEnabled(Context ctx, boolean enabled) {
        prefs(ctx).edit().putBoolean("enabled", enabled).apply();
    }

    /** The copy in Documents/JustMoney on this phone (on by default). */
    public static boolean localEnabled(Context ctx) {
        return prefs(ctx).getBoolean("localEnabled", true);
    }

    public static void setLocalEnabled(Context ctx, boolean on) {
        prefs(ctx).edit().putBoolean("localEnabled", on).apply();
    }

    /** Backs up only if enabled and the last run is older than ~a day. */
    public static synchronized void backupIfDue(Context ctx) throws Exception {
        SharedPreferences p = prefs(ctx);
        if (!isEnabled(ctx)) return;
        long last = Math.max(p.getLong("lastRunAt", 0), p.getLong("lastAt", 0));
        // A little under 24h so the daily worker and app launches don't drift later each day.
        if (System.currentTimeMillis() - last < DAY_MS - 60 * 60 * 1000) return;
        backup(ctx, false);
    }

    /** "Back up now": every destination, regardless of its schedule. */
    public static void backup(Context ctx) throws Exception {
        backup(ctx, true);
    }

    /** Writes the backup. Skips when there is nothing to save. `force` ignores the Google Drive schedule. */
    public static synchronized void backup(Context ctx, boolean force) throws Exception {
        SharedPreferences p = prefs(ctx);
        JustMoneyDb db = JustMoneyDb.get(ctx);
        if (db.countTransactions() == 0 && db.getItem("@User") == null) return; // fresh install: never overwrite a real backup with nothing

        // Backups are always encrypted with the user's password. Until one is set nothing is written, so a readable copy never lands in shared storage.
        if (!CloudBackup.localProtected(ctx)) {
            p.edit().putString("lastError", "Set a backup password to back up. Backups are always encrypted.").putLong("lastRunAt", System.currentTimeMillis()).apply();
            return;
        }
        byte[] plainBytes = buildJson(db).getBytes(StandardCharsets.UTF_8);
        byte[] bytes = CloudBackup.encryptLocal(ctx, plainBytes).getBytes(StandardCharsets.UTF_8);
        // Each destination succeeds or fails on its own: a full phone shouldn't stop the Drive copy, or vice versa.
        Exception localError = null;
        if (localEnabled(ctx)) {
            try {
                String name = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? writeMediaStore(ctx, p, bytes) : writeLegacy(ctx, p, bytes);
                if (name != null) p.edit().putLong("lastAt", System.currentTimeMillis()).putString("file", name).remove("lastError").apply();
                // name == null: held back to protect an older backup (see foundOlder)
            } catch (Exception e) {
                p.edit().putString("lastError", e.getMessage() != null ? e.getMessage() : e.toString()).apply();
                localError = e;
            }
        }
        boolean cloud = CloudBackup.configured(ctx);
        if (cloud && (force || CloudBackup.due(ctx))) CloudBackup.write(ctx, plainBytes); // records its own success / error
        p.edit().putLong("lastRunAt", System.currentTimeMillis()).apply();
        if (localError != null && !cloud) throw localError;
    }

    /** The full backup as JSON (for "Save a copy to…"). */
    public static byte[] snapshot(Context ctx) throws Exception {
        if (!CloudBackup.localProtected(ctx)) throw new SecurityException("Set a backup password first. Backups are always encrypted.");
        return CloudBackup.encryptLocal(ctx, buildJson(JustMoneyDb.get(ctx)).getBytes(StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8);
    }

    static String buildJson(JustMoneyDb db) throws Exception {
        JSONObject root = new JSONObject();
        root.put("app", "JustMoney");
        root.put("version", 3);
        root.put("source", "android");
        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        root.put("exportedAt", iso.format(new Date()));

        JSONArray txns = new JSONArray();
        for (String json : db.getAllTransactionJson()) txns.put(new JSONObject(json));
        root.put("transactions", txns);

        // parts of the data the user chose to leave out (Settings → What to back up): the app keeps this list in the same database
        Set<String> left = new HashSet<>();
        try {
            String raw = db.getItem("@BackupExcluded");
            if (raw != null) { JSONArray a = new JSONArray(raw); for (int i = 0; i < a.length(); i++) left.add(a.getString(i)); }
        } catch (Exception ignored) { }
        JSONObject kv = new JSONObject();
        for (Map.Entry<String, String> e : db.getAllKv().entrySet()) {
            if (EXCLUDED.contains(e.getKey()) || left.contains(e.getKey())) continue;
            kv.put(e.getKey(), new JSONTokener(e.getValue()).nextValue());
        }
        root.put("kv", kv);
        return root.toString();
    }

    /* ---------- Android 10+ : MediaStore, no permission needed for the app's own files ---------- */

    private static String relativePath() {
        return Environment.DIRECTORY_DOCUMENTS + "/" + DIR + "/";
    }

    private static Uri collection() {
        return MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
    }

    private static String writeMediaStore(Context ctx, SharedPreferences p, byte[] bytes) throws Exception {
        ContentResolver cr = ctx.getContentResolver();
        // The new copy is written in full, hidden, before the old one goes: a full phone or a killed app never leaves an empty backup.
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, "justmoney-backup-new.json");
        v.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath());
        v.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri fresh = cr.insert(collection(), v);
        if (fresh == null) throw new IllegalStateException("Could not create the backup file in Documents");
        if (!tryWrite(cr, fresh, bytes)) {
            try { cr.delete(fresh, null, null); } catch (Exception ignored) { }
            throw new IllegalStateException("Could not write the backup file");
        }
        // only now the previous copy of ours goes; an earlier install's file (not ours) is left alone
        String saved = p.getString("uri", null);
        Uri old = saved != null ? Uri.parse(saved) : findOwn(cr);
        if (old != null) { try { cr.delete(old, null, null); } catch (Exception ignored) { } }
        ContentValues done = new ContentValues();
        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
        done.put(MediaStore.MediaColumns.DISPLAY_NAME, FILE);
        try {
            cr.update(fresh, done, null, null);
        } catch (Exception e) {
            ContentValues visible = new ContentValues();
            visible.put(MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(fresh, visible, null, null);
        }
        p.edit().putString("uri", fresh.toString()).apply();
        return displayName(cr, fresh);
    }

    private static boolean tryWrite(ContentResolver cr, Uri uri, byte[] bytes) {
        // "rwt" truncates reliably; plain "w" can leave stale bytes at the end on some versions.
        try (OutputStream os = cr.openOutputStream(uri, "rwt")) {
            if (os == null) return false;
            os.write(bytes);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static Uri findOwn(ContentResolver cr) {
        String sel = MediaStore.MediaColumns.RELATIVE_PATH + "=? AND " + MediaStore.MediaColumns.DISPLAY_NAME + "=?";
        try (Cursor c = cr.query(collection(), new String[]{MediaStore.MediaColumns._ID}, sel, new String[]{relativePath(), FILE}, null)) {
            if (c != null && c.moveToFirst()) return ContentUris.withAppendedId(collection(), c.getLong(0));
        } catch (Exception ignored) {
        }
        return null;
    }

    private static String displayName(ContentResolver cr, Uri uri) {
        try (Cursor c = cr.query(uri, new String[]{MediaStore.MediaColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {
        }
        return FILE;
    }

    /* ---------- Android 9 and older : plain file with storage permission ---------- */

    @SuppressWarnings("deprecation")
    private static File legacyFile() {
        return new File(new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), DIR), FILE);
    }

    private static String writeLegacy(Context ctx, SharedPreferences p, byte[] bytes) throws Exception {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            throw new SecurityException("Storage permission is needed to save backups on this Android version");
        }
        File f = legacyFile();
        // Old Android lets any install overwrite the file, so protect one left by an earlier install.
        if (f.exists() && !p.getBoolean("dismissedOlder", false)) {
            JSONObject old = new JSONObject(new String(readAll(new FileInputStream(f)), StandardCharsets.UTF_8));
            long oldAt = parseIso(old.optString("exportedAt"));
            int oldCount = old.optJSONArray("transactions") != null ? old.optJSONArray("transactions").length() : 0;
            if (oldAt > 0 && oldAt < p.getLong("installedAt", 0) && oldCount > JustMoneyDb.get(ctx).countTransactions()) {
                p.edit().putString("foundOlderAt", old.optString("exportedAt")).putInt("foundOlderCount", oldCount).apply();
                return null;
            }
        }
        File dir = f.getParentFile();
        if (dir != null && !dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Could not create Documents/" + DIR);
        File tmp = new File(dir, FILE + ".tmp");
        try (FileOutputStream os = new FileOutputStream(tmp)) {
            os.write(bytes);
            os.getFD().sync();
        }
        if (!tmp.renameTo(f)) { // rename over an existing file can fail on some filesystems
            if (!f.delete() || !tmp.renameTo(f)) throw new IllegalStateException("Could not replace the backup file");
        }
        return FILE;
    }

    /* ---------- reading back (for one-tap restore) ---------- */

    public static String readOwnBackup(Context ctx) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver cr = ctx.getContentResolver();
                String saved = prefs(ctx).getString("uri", null);
                Uri uri = saved != null ? Uri.parse(saved) : findOwn(cr);
                if (uri == null) return null;
                try (InputStream is = cr.openInputStream(uri)) {
                    return is == null ? null : new String(readAll(is), StandardCharsets.UTF_8);
                }
            }
            File f = legacyFile();
            return f.exists() ? new String(readAll(new FileInputStream(f)), StandardCharsets.UTF_8) : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static byte[] readAll(InputStream is) throws Exception {
        try (InputStream in = is; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private static long parseIso(String s) {
        try {
            SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            iso.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date d = iso.parse(s);
            return d != null ? d.getTime() : 0;
        } catch (Exception e) {
            return 0;
        }
    }
}
