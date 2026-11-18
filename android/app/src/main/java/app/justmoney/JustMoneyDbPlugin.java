package app.justmoney;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.annotation.ActivityCallback;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** JS bridge to the SQLite store and the daily backup. Capacitor runs these off the UI thread. */
@CapacitorPlugin(name = "JustMoneyDb")
public class JustMoneyDbPlugin extends Plugin {

    private JustMoneyDb db() {
        return JustMoneyDb.get(getContext());
    }

    @PluginMethod
    public void loadAll(PluginCall call) {
        try {
            JSObject kv = new JSObject();
            for (Map.Entry<String, String> e : db().getAllKv().entrySet()) kv.put(e.getKey(), e.getValue());
            JSArray txns = new JSArray();
            for (String json : db().getAllTransactionJson()) txns.put(json);
            JSObject ret = new JSObject();
            ret.put("kv", kv);
            ret.put("transactions", txns);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not read the database", e);
        }
    }

    @PluginMethod
    public void setItem(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || value == null) { call.reject("key and value are required"); return; }
        try {
            db().setItem(key, value);
        } catch (Vault.Unavailable e) {
            call.reject(e.getMessage());
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void removeItem(PluginCall call) {
        String key = call.getString("key");
        if (key == null) { call.reject("key is required"); return; }
        db().removeItem(key);
        call.resolve();
    }

    /** { upserts: [{ id, timestamp, json }], deletes: [id] } applied atomically. */
    @PluginMethod
    public void applyTransactionChanges(PluginCall call) {
        try {
            List<JustMoneyDb.TxRow> upserts = new ArrayList<>();
            JSONArray up = call.getArray("upserts", new JSArray());
            for (int i = 0; i < up.length(); i++) {
                JSONObject r = up.getJSONObject(i);
                upserts.add(new JustMoneyDb.TxRow(r.getString("id"), r.getLong("timestamp"), r.getString("json")));
            }
            List<String> deletes = new ArrayList<>();
            JSONArray del = call.getArray("deletes", new JSArray());
            for (int i = 0; i < del.length(); i++) deletes.add(del.getString(i));
            db().applyTransactionChanges(upserts, deletes);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not save transactions", e);
        }
    }

    @PluginMethod
    public void refreshWidget(PluginCall call) {
        WidgetKit.updateAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        db().clearAll();
        call.resolve();
    }

    /* ---------- backup ---------- */

    @PluginMethod
    public void scheduleDailyBackup(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", BackupWriter.isEnabled(getContext()));
        BackupWriter.setEnabled(getContext(), enabled);
        BackupWorker.schedule(getContext(), enabled);
        call.resolve(status());
    }

    /** Whether the background backup shows a "Backup saved" notification. */
    @PluginMethod
    public void setBackupNotify(PluginCall call) {
        BackupWriter.prefs(getContext()).edit().putBoolean("notifyDone", Boolean.TRUE.equals(call.getBoolean("on", true))).apply();
        call.resolve();
    }

    @PluginMethod
    public void backupNow(PluginCall call) {
        try {
            BackupWriter.backup(getContext());
            call.resolve(status());
        } catch (Exception e) {
            JSObject s = status();
            s.put("error", e.getMessage());
            call.resolve(s);
        }
    }

    @PluginMethod
    public void backupIfDue(PluginCall call) {
        try {
            BackupWriter.backupIfDue(getContext());
        } catch (Exception ignored) {
            // recorded in status.lastError
        }
        call.resolve(status());
    }

    @PluginMethod
    public void getBackupStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void readBackup(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("text", BackupWriter.readOwnBackup(getContext()));
        call.resolve(ret);
    }

    /* ---------- encrypted cloud copy (e.g. Google Drive via the system file picker) ---------- */

    @PluginMethod
    public void pickCloudBackupFile(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("application/json");
        i.putExtra(Intent.EXTRA_TITLE, "justmoney-backup-encrypted.json");
        startActivityForResult(call, i, "onCloudFilePicked");
    }

    @ActivityCallback
    private void onCloudFilePicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("No location chosen");
            return;
        }
        Uri uri = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (SecurityException ignored) {
            // some providers grant only for this session; writing may then stop after a restart
        }
        String name = "justmoney-backup-encrypted.json";
        try (Cursor c = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception ignored) {
        }
        BackupWriter.prefs(getContext()).edit().putString("cloudUri", uri.toString()).putString("cloudName", name)
                .putString("cloudProvider", uri.getAuthority()).apply();
        call.resolve(status());
    }

    @PluginMethod
    public void setCloudPassword(PluginCall call) {
        String pw = call.getString("password");
        if (pw == null || pw.length() < 6) { call.reject("Use at least 6 characters"); return; }
        try {
            CloudBackup.setPassword(getContext(), pw);
            call.resolve(status());
        } catch (Exception e) {
            call.reject("Could not set up encryption: " + e.getMessage());
        }
    }

    @PluginMethod
    public void verifyBackupPassword(PluginCall call) {
        String pw = call.getString("password");
        JSObject o = new JSObject();
        o.put("ok", pw != null && CloudBackup.verifyPassword(getContext(), pw));
        call.resolve(o);
    }

    @PluginMethod
    public void setCloudFrequency(PluginCall call) {
        BackupWriter.prefs(getContext()).edit().putString("cloudFrequency", call.getString("frequency", "daily")).apply();
        call.resolve(status());
    }

    @PluginMethod
    public void setLocalBackupEnabled(PluginCall call) {
        BackupWriter.setLocalEnabled(getContext(), Boolean.TRUE.equals(call.getBoolean("enabled", true)));
        call.resolve(status());
    }

    /** One-off copy to any place the user picks (Downloads, SD card, Drive…). */
    @PluginMethod
    public void exportBackupTo(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("application/json");
        i.putExtra(Intent.EXTRA_TITLE, "justmoney-backup-" + new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(new java.util.Date()) + ".json");
        startActivityForResult(call, i, "onExportPicked");
    }

    @ActivityCallback
    private void onExportPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("No location chosen");
            return;
        }
        try {
            CloudBackup.writeTo(getContext(), result.getData().getData(), BackupWriter.snapshot(getContext()));
            JSObject ret = new JSObject();
            ret.put("saved", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not save the backup: " + e.getMessage());
        }
    }

    @PluginMethod
    public void disableCloudBackup(PluginCall call) {
        CloudBackup.disable(getContext());
        call.resolve(status());
    }

    /** The older backup was restored or the user chose to ignore it: it may now be overwritten. */
    @PluginMethod
    public void dismissOlder(PluginCall call) {
        BackupWriter.prefs(getContext()).edit().putBoolean("dismissedOlder", true)
                .remove("foundOlderAt").remove("foundOlderCount").apply();
        call.resolve(status());
    }

    private JSObject status() {
        SharedPreferences p = BackupWriter.prefs(getContext());
        JSObject s = new JSObject();
        s.put("enabled", p.getBoolean("enabled", true));
        s.put("localEnabled", BackupWriter.localEnabled(getContext()));
        long last = p.getLong("lastAt", 0);
        s.put("lastAt", last > 0 ? last : null);
        s.put("file", p.getString("file", BackupWriter.FILE));
        s.put("lastError", p.getString("lastError", null));
        if (p.contains("foundOlderAt")) {
            JSObject older = new JSObject();
            older.put("exportedAt", p.getString("foundOlderAt", ""));
            older.put("transactions", p.getInt("foundOlderCount", 0));
            s.put("foundOlder", older);
        } else {
            s.put("foundOlder", null);
        }
        s.put("dismissedOlder", p.getBoolean("dismissedOlder", false));
        s.put("localEncrypted", CloudBackup.localProtected(getContext()));
        s.put("dataEncrypted", Vault.available(getContext()));
        JSObject cloud = new JSObject();
        cloud.put("configured", CloudBackup.configured(getContext()));
        cloud.put("encrypted", true); // the cloud copy is always encrypted
        cloud.put("frequency", CloudBackup.frequency(getContext()));
        cloud.put("hasLocation", p.getString("cloudUri", null) != null);
        cloud.put("name", p.getString("cloudName", null));
        cloud.put("provider", p.getString("cloudProvider", null));
        long cl = p.getLong("cloudLastAt", 0);
        cloud.put("lastAt", cl > 0 ? cl : null);
        cloud.put("error", p.getString("cloudError", null));
        s.put("cloud", cloud);
        return s;
    }
}
