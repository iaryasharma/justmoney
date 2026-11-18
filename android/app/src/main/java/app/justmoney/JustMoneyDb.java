package app.justmoney;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The app's on-device database.
 *
 * - transactions: one row per transaction (the bulk of the data), indexed by time.
 * - kv: every other setting / collection as a JSON value under its storage key
 *   (the same keys the web layer uses, e.g. "@User", "@SplitwiseSplits").
 *
 * A single shared instance is used by the JS bridge and the background backup
 * worker, so SQLite serialises their access.
 */
public final class JustMoneyDb extends SQLiteOpenHelper {
    private static final String NAME = "justmoney.db";
    private static final int VERSION = 2;
    private static volatile JustMoneyDb instance;

    public static JustMoneyDb get(Context ctx) {
        if (instance == null) {
            synchronized (JustMoneyDb.class) {
                if (instance == null) instance = new JustMoneyDb(ctx.getApplicationContext());
            }
        }
        return instance;
    }

    private final Context appCtx;

    private JustMoneyDb(Context ctx) {
        super(ctx, NAME, null, VERSION);
        appCtx = ctx;
        setWriteAheadLoggingEnabled(true);
    }

    @Override
    public void onOpen(SQLiteDatabase db) {
        super.onOpen(db);
        // deleted and replaced values are overwritten with zeros in the file, so old plaintext does not linger
        try (Cursor c = db.rawQuery("PRAGMA secure_delete = ON", null)) { c.moveToFirst(); }
        // if the key is unavailable the migration is rolled back and tried again on the next start; the database still opens
        try { encryptExisting(db); } catch (Vault.Unavailable ignored) { }
    }

    private static boolean migrated;

    /**
     * One time, on the first start after encryption arrived: every value already in the database is encrypted in place, then the
     * file is compacted so the old plaintext is gone from it too. Values that are already encrypted are left alone.
     */
    private synchronized void encryptExisting(SQLiteDatabase db) {
        if (migrated) return;
        migrated = true;
        if (!Vault.available(appCtx)) return;
        android.content.SharedPreferences p = appCtx.getSharedPreferences("justmoney_vault", Context.MODE_PRIVATE);
        if (p.getBoolean("migrated", false)) return;
        boolean any = false;
        db.beginTransaction();
        try {
            List<String[]> kv = new ArrayList<>();
            try (Cursor c = db.rawQuery("SELECT key, value FROM kv", null)) { while (c.moveToNext()) kv.add(new String[]{c.getString(0), c.getString(1)}); }
            for (String[] r : kv) {
                if (Vault.isEncrypted(r[1])) continue;
                ContentValues v = new ContentValues(); v.put("value", Vault.encrypt(appCtx, "kv:" + r[0], r[1]));
                db.update("kv", v, "key = ?", new String[]{r[0]}); any = true;
            }
            List<String[]> tx = new ArrayList<>();
            try (Cursor c = db.rawQuery("SELECT id, json FROM transactions", null)) { while (c.moveToNext()) tx.add(new String[]{c.getString(0), c.getString(1)}); }
            for (String[] r : tx) {
                if (Vault.isEncrypted(r[1])) continue;
                ContentValues v = new ContentValues(); v.put("json", Vault.encrypt(appCtx, "tx:" + r[0], r[1]));
                db.update("transactions", v, "id = ?", new String[]{r[0]}); any = true;
            }
            List<String[]> cap = new ArrayList<>();
            try (Cursor c = db.rawQuery("SELECT id, title, text FROM captured", null)) { while (c.moveToNext()) cap.add(new String[]{c.getString(0), c.getString(1), c.getString(2)}); }
            for (String[] r : cap) {
                if (Vault.isEncrypted(r[2])) continue;
                ContentValues v = new ContentValues(); v.put("title", Vault.encrypt(appCtx, "cap", r[1])); v.put("text", Vault.encrypt(appCtx, "cap", r[2]));
                db.update("captured", v, "id = ?", new String[]{r[0]}); any = true;
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        p.edit().putBoolean("migrated", true).apply();
        if (any) {
            try { db.execSQL("VACUUM"); } catch (Exception ignored) { }
            try (Cursor c = db.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", null)) { c.moveToFirst(); } catch (Exception ignored) { }
        }
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE transactions (id TEXT PRIMARY KEY NOT NULL, timestamp INTEGER NOT NULL, json TEXT NOT NULL)");
        db.execSQL("CREATE INDEX idx_transactions_timestamp ON transactions (timestamp DESC)");
        createCaptured(db);
    }

    /** v2: payment notifications captured by the listener, waiting for the app to turn them into transactions. */
    private static void createCaptured(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS captured (id INTEGER PRIMARY KEY AUTOINCREMENT, pkg TEXT NOT NULL, title TEXT, text TEXT NOT NULL, ts INTEGER NOT NULL, fingerprint TEXT UNIQUE)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) createCaptured(db);
    }

    /* ---------- captured notifications ---------- */

    /** Stores a captured notification; the same text from the same app within a minute is stored once. */
    public boolean addCaptured(String pkg, String title, String text, long ts) {
        ContentValues v = new ContentValues();
        v.put("pkg", pkg);
        try {
            v.put("title", Vault.encrypt(appCtx, "cap", title));
            v.put("text", Vault.encrypt(appCtx, "cap", text));
        } catch (Vault.Unavailable e) {
            return false; // never kept in plain text: the message is dropped rather than stored unencrypted
        }
        v.put("ts", ts);
        v.put("fingerprint", pkg + "|" + Fingerprint.of(text) + "|" + (ts / 60000));
        return getWritableDatabase().insertWithOnConflict("captured", null, v, SQLiteDatabase.CONFLICT_IGNORE) != -1;
    }

    /** Returns and removes all captured notifications, oldest first. */
    public List<String[]> takeCaptured() {
        List<String[]> out = new ArrayList<>();
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            try (Cursor c = db.rawQuery("SELECT id, pkg, title, text, ts FROM captured ORDER BY ts ASC", null)) {
                while (c.moveToNext()) {
                    String title = Vault.decrypt(appCtx, "cap", c.getString(2));
                    String text = Vault.decrypt(appCtx, "cap", c.getString(3));
                    if (text == null) continue;
                    out.add(new String[]{c.getString(0), c.getString(1), title, text, c.getString(4)});
                }
            }
            for (String[] r : out) db.delete("captured", "id = ?", new String[]{r[0]});
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        return out;
    }

    /* ---------- kv ---------- */

    public Map<String, String> getAllKv() {
        Map<String, String> out = new LinkedHashMap<>();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT key, value FROM kv", null)) {
            while (c.moveToNext()) {
                String v = Vault.decryptOrThrow(appCtx, "kv:" + c.getString(0), c.getString(1));
                if (v != null) out.put(c.getString(0), v);
            }
        }
        return out;
    }

    public String getItem(String key) {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT value FROM kv WHERE key = ?", new String[]{key})) {
            return c.moveToFirst() ? Vault.decrypt(appCtx, "kv:" + key, c.getString(0)) : null;
        }
    }

    public void setItem(String key, String value) {
        ContentValues v = new ContentValues();
        v.put("key", key);
        v.put("value", Vault.encrypt(appCtx, "kv:" + key, value));
        getWritableDatabase().insertWithOnConflict("kv", null, v, SQLiteDatabase.CONFLICT_REPLACE);
    }

    public void removeItem(String key) {
        getWritableDatabase().delete("kv", "key = ?", new String[]{key});
    }

    /* ---------- transactions ---------- */

    /** All transactions as JSON strings, newest first. */
    public List<String> getAllTransactionJson() {
        List<String> out = new ArrayList<>();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT id, json FROM transactions ORDER BY timestamp DESC", null)) {
            while (c.moveToNext()) { String j = Vault.decryptOrThrow(appCtx, "tx:" + c.getString(0), c.getString(1)); if (j != null) out.add(j); }
        }
        return out;
    }

    /** Transactions at or after a time (for the widget's today / this-month totals). */
    public List<String> getTransactionJsonSince(long since) {
        List<String> out = new ArrayList<>();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT id, json FROM transactions WHERE timestamp >= ?", new String[]{String.valueOf(since)})) {
            while (c.moveToNext()) { String j = Vault.decrypt(appCtx, "tx:" + c.getString(0), c.getString(1)); if (j != null) out.add(j); }
        }
        return out;
    }

    public int countTransactions() {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM transactions", null)) {
            return c.moveToFirst() ? c.getInt(0) : 0;
        }
    }

    public static final class TxRow {
        public final String id;
        public final long timestamp;
        public final String json;

        public TxRow(String id, long timestamp, String json) {
            this.id = id;
            this.timestamp = timestamp;
            this.json = json;
        }
    }

    /** Inserts or replaces rows and deletes ids, all in one transaction. */
    public void applyTransactionChanges(List<TxRow> upserts, List<String> deletes) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (TxRow r : upserts) {
                ContentValues v = new ContentValues();
                v.put("id", r.id);
                v.put("timestamp", r.timestamp);
                v.put("json", Vault.encrypt(appCtx, "tx:" + r.id, r.json));
                db.insertWithOnConflict("transactions", null, v, SQLiteDatabase.CONFLICT_REPLACE);
            }
            for (String id : deletes) db.delete("transactions", "id = ?", new String[]{id});
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    public void clearAll() {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("kv", null, null);
            db.delete("transactions", null, null);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }
}
