package app.justmoney;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Checks GitHub for a newer JustMoney release and installs it. The APK is downloaded, its SHA-256 is checked against the digest GitHub
 * publishes, and then Android's installer opens. Android always asks the user to confirm, and it refuses an APK signed by another key.
 */
@CapacitorPlugin(name = "Updater")
public class UpdaterPlugin extends Plugin {
    static final String LATEST = "https://api.github.com/repos/iaryasharma/justmoney/releases/latest";
    /** Only APKs from this repository's releases are downloaded, whatever the web layer asks for. */
    static final String DOWNLOAD_PREFIX = "https://github.com/iaryasharma/justmoney/releases/download/";

    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences("justmoney_update", Context.MODE_PRIVATE);
    }

    static String installedVersion(Context ctx) {
        try {
            return ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "0";
        }
    }

    /** The newest release: version, notes, page, the APK's address, size and SHA-256. Throws when GitHub or the network fails. */
    static JSONObject fetchLatest() throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(LATEST).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(15000);
        c.setRequestProperty("Accept", "application/vnd.github+json");
        c.setRequestProperty("User-Agent", "JustMoney-app");
        if (c.getResponseCode() != 200) throw new IOException("GitHub answered " + c.getResponseCode());
        JSONObject release = new JSONObject(readText(c.getInputStream()));
        JSONObject out = new JSONObject();
        out.put("version", release.getString("tag_name").replaceFirst("^[vV]", ""));
        out.put("notes", release.optString("body", ""));
        out.put("page", release.optString("html_url", ""));
        JSONArray assets = release.getJSONArray("assets");
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            if (asset.getString("name").endsWith(".apk")) {
                out.put("url", asset.getString("browser_download_url"));
                out.put("size", asset.optLong("size", 0));
                out.put("sha256", asset.optString("digest", "").replaceFirst("^sha256:", ""));
                break;
            }
        }
        if (!out.has("url")) throw new IOException("the newest release has no APK");
        return out;
    }

    private static String readText(InputStream in) throws IOException {
        try (InputStream src = in) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = src.read(chunk)) != -1) buf.write(chunk, 0, n);
            return new String(buf.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("installed", installedVersion(getContext()));
        r.put("daily", prefs(getContext()).getBoolean("daily", true));
        call.resolve(r);
    }

    @PluginMethod
    public void setDaily(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        prefs(getContext()).edit().putBoolean("daily", on).apply();
        UpdateWorker.schedule(getContext(), on);
        call.resolve();
    }

    @PluginMethod
    public void check(PluginCall call) {
        worker.execute(() -> {
            try {
                JSONObject info = fetchLatest();
                String installed = installedVersion(getContext());
                JSObject r = new JSObject();
                r.put("version", info.getString("version"));
                r.put("notes", info.getString("notes"));
                r.put("page", info.getString("page"));
                r.put("url", info.getString("url"));
                r.put("size", info.getLong("size"));
                r.put("sha256", info.getString("sha256"));
                r.put("installed", installed);
                r.put("newer", Semver.compare(info.getString("version"), installed) > 0);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Could not check for updates. Check your connection and try again.");
            }
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url", "");
        String sha256 = call.getString("sha256", "");
        String version = call.getString("version", "");
        worker.execute(() -> {
            try {
                if (!url.startsWith(DOWNLOAD_PREFIX)) {
                    call.reject("That download is not from the JustMoney releases.");
                    return;
                }
                File dir = new File(getContext().getCacheDir(), "updates");
                dir.mkdirs();
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete(); // only our own earlier downloads live here
                File apk = new File(dir, "JustMoney-" + version.replaceAll("[^0-9A-Za-z.]", "") + ".apk");
                download(url, apk);
                if (!sha256.isEmpty() && !sha256.equalsIgnoreCase(sha256Of(apk))) {
                    apk.delete();
                    call.reject("The download did not match the published file, so nothing was installed.");
                    return;
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
                    Intent allow = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                    allow.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(allow);
                    JSObject r = new JSObject();
                    r.put("opened", false);
                    r.put("needsPermission", true);
                    call.resolve(r);
                    return;
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent install = new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(install);
                JSObject r = new JSObject();
                r.put("opened", true);
                r.put("needsPermission", false);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("The update could not be downloaded. Check your connection and try again.");
            }
        });
    }

    private void download(String url, File target) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(true); // GitHub sends the file from another host
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        long total = c.getContentLengthLong();
        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(target)) {
            byte[] buf = new byte[65536];
            long got = 0, lastSent = 0;
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                got += n;
                if (got - lastSent >= 256 * 1024 || (total > 0 && got >= total)) {
                    lastSent = got;
                    JSObject p = new JSObject();
                    p.put("received", got);
                    p.put("total", total);
                    notifyListeners("progress", p);
                }
            }
        }
    }

    private static String sha256Of(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) != -1) md.update(buf, 0, n);
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : md.digest()) hex.append(String.format("%02x", b));
        return hex.toString();
    }
}
