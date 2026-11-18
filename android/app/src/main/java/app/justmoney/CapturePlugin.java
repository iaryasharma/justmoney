package app.justmoney;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.genai.common.DownloadCallback;
import com.google.mlkit.genai.common.FeatureStatus;
import com.google.mlkit.genai.common.GenAiException;
import com.google.mlkit.genai.prompt.Candidate;
import com.google.mlkit.genai.prompt.GenerateContentResponse;
import com.google.mlkit.genai.prompt.Generation;
import com.google.mlkit.genai.prompt.java.GenerativeModelFutures;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * On-device intelligence and sharing:
 *  - ocr: ML Kit text recognition (runs fully offline on every phone).
 *  - nano*: Gemini Nano through ML Kit's Prompt API, on phones that ship it (AICore).
 *  - shares: screenshots / photos / text shared to JustMoney from any app, and
 *    "JustMoney" in the text-selection menu.
 */
@CapacitorPlugin(name = "Capture", permissions = {
        @com.getcapacitor.annotation.Permission(strings = { android.Manifest.permission.READ_SMS, android.Manifest.permission.RECEIVE_SMS }, alias = "sms")
})
public class CapturePlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final List<JSObject> pending = new ArrayList<>();
    private TextRecognizer recognizer;
    /** Hindi/Marathi text as well as English, used first; the English-only reader stays as a fallback. */
    private TextRecognizer devanagari;
    private GenerativeModelFutures nano;

    @Override
    public void load() {
        ensureLauncherIcon();
        Intent launch = getActivity().getIntent();
        if (launch != null) handleIntent(launch, false);
        PaymentNotificationListener.callback = () -> notifyListeners("paymentCaptured", new JSObject());
    }

    @Override
    protected void handleOnDestroy() {
        PaymentNotificationListener.callback = null;
        super.handleOnDestroy();
    }

    /* ---------- payment notification capture ---------- */

    @PluginMethod
    public void notificationAccessStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", androidx.core.app.NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName()));
        call.resolve(ret);
    }

    @PluginMethod
    public void openNotificationAccessSettings(PluginCall call) {
        Intent i = new Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    private static final String[] ICONS = { "Default", "Blue", "Green", "Orange", "Pink", "Teal", "Light", "Classic", "ClassicPink", "Rose", "Crimson", "Gold", "Mono", "Sunset", "Ocean", "Aurora", "Midnight", "Coin", "Growth", "Orbit", "Wallet", "Ledger", "Diwali", "Holi", "Christmas", "Halloween", "Sankranti", "Rakhi", "Navratri", "Spiderman", "Thor", "Captain", "MoonKnightLight", "SpidermanBlack", "SpidermanVerse", "MoonKnightCrescent", "SpidermanWeb", "SpidermanTrapped", "SpidermanGlitch", "MoonKnightEyesDark", "MoonKnightNight", "StrangerUpsideDown", "StrangerLights", "StrangerDemogorgon", "BreakingElement", "BreakingHeisenberg", "MentalistWatch", "StrangerEleven", "StrangerHellfire", "DarkTriquetra", "DarkLoop", "DarkWinden", "LokiTimeline", "Doom", "DoomHood", "BlackPanther", "Loki", "MissMinutes", "MoonKnightHood", "MrKnight", "CaptainJm", "RedJohn", "StrangerCinematic", "StrangerRed", "BlackPantherPurple", "StrangerForest", "StrangerMax", "DarkSeries", "BreakingBad", "SquidGame", "MoneyHeist", "HarryPotter", "GTA", "Valorant", "OPLuffy", "OPSanji", "OPZoro", "OPUsopp", "OPNami", "OPChopper", "OPBrook", "OPRobin", "OPFranky", "OPJinbe", "OPAce", "OPSabo", "IronMan", "Deadpool", "Wolverine", "DoctorStrange", "ClassicBlue", "ClassicOcean", "ClassicMidnight", "BreakingElement2", "Gaming", "AmongUs", "GodOfWar", "BlackMythWukong", "GhostOfTsushima", "Wednesday", "DeathNote", "DSZenitsu", "DSInosuke", "DSTanjiro", "DSNezuko", "Pokemon", "DragonBall", "DietCoke", "RedBull", "MonsterEnergy" };

    /** If no icon alias is enabled (the chosen one no longer exists), the app would vanish from the launcher: turn the default back on. */
    private void ensureLauncherIcon() {
        try {
            android.content.pm.PackageManager pm = getContext().getPackageManager();
            for (String n : ICONS) {
                int s = pm.getComponentEnabledSetting(new android.content.ComponentName(getContext(), "app.justmoney.Icon" + n));
                boolean on = s == android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED || (n.equals("Default") && s == android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DEFAULT);
                if (on) return;
            }
            pm.setComponentEnabledSetting(new android.content.ComponentName(getContext(), "app.justmoney.IconDefault"), android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED, android.content.pm.PackageManager.DONT_KILL_APP);
        } catch (Exception ignored) { }
    }

    /** Which launcher icon is in use ("Default", "Blue", ...). */
    @PluginMethod
    public void getAppIcon(PluginCall call) {
        android.content.pm.PackageManager pm = getContext().getPackageManager();
        String current = "Default";
        for (String n : ICONS) {
            int s = pm.getComponentEnabledSetting(new android.content.ComponentName(getContext(), "app.justmoney.Icon" + n));
            if (s == android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED || (n.equals("Default") && s == android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DEFAULT)) { current = n; if (s == android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED) break; }
        }
        JSObject ret = new JSObject();
        ret.put("name", current);
        call.resolve(ret);
    }

    /** Switches the launcher icon: enables the chosen alias first, then disables the others, without restarting the app. */
    @PluginMethod
    public void setAppIcon(PluginCall call) {
        String name = call.getString("name", "Default");
        boolean known = false;
        for (String n : ICONS) if (n.equals(name)) known = true;
        if (!known) { call.reject("Unknown icon"); return; }
        android.content.pm.PackageManager pm = getContext().getPackageManager();
        pm.setComponentEnabledSetting(new android.content.ComponentName(getContext(), "app.justmoney.Icon" + name), android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED, android.content.pm.PackageManager.DONT_KILL_APP);
        for (String n : ICONS) {
            if (n.equals(name)) continue;
            pm.setComponentEnabledSetting(new android.content.ComponentName(getContext(), "app.justmoney.Icon" + n), android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED, android.content.pm.PackageManager.DONT_KILL_APP);
        }
        call.resolve();
    }

    /** The pinned quick-add notification: a foreground service holds it so it cannot be swiped away. */
    @PluginMethod
    public void setPinnedQuickAdd(PluginCall call) {
        QuickAddService.apply(getContext(), Boolean.TRUE.equals(call.getBoolean("on", false)));
        call.resolve();
    }

    /* ---------- bank text messages ---------- */

    @PluginMethod
    public void smsStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("sms") == com.getcapacitor.PermissionState.GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestSms(PluginCall call) {
        if (getPermissionState("sms") == com.getcapacitor.PermissionState.GRANTED) { smsStatus(call); return; }
        requestPermissionForAlias("sms", call, "smsPermissionResult");
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void smsPermissionResult(PluginCall call) { smsStatus(call); }

    /**
     * Reads the inbox for bank messages from the last `days` days that look like a payment and keeps them for the app to read,
     * so what was missed (a muted, filtered or late message) is caught up. Nothing else in the inbox is read or kept.
     */
    @PluginMethod
    public void scanSms(PluginCall call) {
        if (getPermissionState("sms") != com.getcapacitor.PermissionState.GRANTED) { call.reject("SMS permission is not granted"); return; }
        final int days = Math.max(1, Math.min(120, call.getInt("days", 30)));
        final boolean holdsOnly = Boolean.TRUE.equals(call.getBoolean("holdsOnly", false));   // only IPO block / unblock notices: nothing already dealt with is brought back
        worker.execute(() -> {
            int scanned = 0, added = 0;
            long since = System.currentTimeMillis() - days * 86400000L;
            try (android.database.Cursor c = getContext().getContentResolver().query(android.net.Uri.parse("content://sms/inbox"),
                    new String[]{"address", "body", "date"}, "date >= ?", new String[]{String.valueOf(since)}, "date ASC")) {
                while (c != null && c.moveToNext()) {
                    String sender = c.getString(0), body = c.getString(1);
                    long ts = c.getLong(2);
                    if (body == null) continue;
                    scanned++;
                    if (!SmsReceiver.fromBusiness(sender) || !(holdsOnly ? PaymentNotificationListener.looksLikeHold(body) : PaymentNotificationListener.looksLikePayment(body))) continue;
                    if (JustMoneyDb.get(getContext()).addCaptured("sms:" + sender, sender, body, ts)) added++;
                }
            } catch (Exception e) {
                call.reject("Could not read messages: " + e.getMessage());
                return;
            }
            JSObject ret = new JSObject();
            ret.put("scanned", scanned);
            ret.put("added", added);
            call.resolve(ret);
        });
    }

    /** Returns and clears captured payment notifications: [{ id, pkg, title, text, ts }]. */
    @PluginMethod
    public void takeCapturedPayments(PluginCall call) {
        JSArray out = new JSArray();
        for (String[] r : JustMoneyDb.get(getContext()).takeCaptured()) {
            JSObject o = new JSObject();
            o.put("id", Long.parseLong(r[0]));
            o.put("pkg", r[1]);
            o.put("title", r[2]);
            o.put("text", r[3]);
            o.put("ts", Long.parseLong(r[4]));
            out.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("items", out);
        call.resolve(ret);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleIntent(intent, true);
    }

    /* ---------- receiving shares ---------- */

    private void handleIntent(Intent intent, boolean live) {
        String action = intent.getAction();
        if (action == null) return;
        JSObject share = null;
        try {
            if (Intent.ACTION_SEND.equals(action)) {
                String type = intent.getType() != null ? intent.getType() : "";
                if (type.startsWith("image/") || type.equals("application/pdf")) {
                    Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                    share = imagesShare(uri != null ? Collections.singletonList(uri) : Collections.<Uri>emptyList());
                } else {
                    String text = intent.getStringExtra(Intent.EXTRA_TEXT);
                    if (text != null) share = textShare(text);
                }
            } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                share = imagesShare(uris != null ? uris : new ArrayList<>());
            } else if (Intent.ACTION_PROCESS_TEXT.equals(action)) {
                CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
                if (text != null) share = textShare(text.toString());
            }
        } catch (Exception | OutOfMemoryError e) {
            // a share that cannot be read is reported, never a crash
            share = new JSObject();
            share.put("kind", "error");
            share.put("message", e.getMessage());
        }
        if (share == null) return;
        // Consume the intent so a configuration change or relaunch doesn't import it twice.
        getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        synchronized (pending) {
            pending.add(share);
        }
        if (live) notifyListeners("shareReceived", share, true);
    }

    private JSObject textShare(String text) {
        JSObject s = new JSObject();
        s.put("kind", "text");
        s.put("text", text);
        return s;
    }

    /** A receipt shared as a PDF (Paytm, PhonePe and Google Pay can all do this): its first page becomes a picture, so it is read like a screenshot. */
    private void pdfToImage(File f) {
        try {
            byte[] head = new byte[4];
            try (InputStream in = new FileInputStream(f)) { if (in.read(head) < 4) return; }
            if (head[0] != '%' || head[1] != 'P' || head[2] != 'D' || head[3] != 'F') return;
            try (android.os.ParcelFileDescriptor fd = android.os.ParcelFileDescriptor.open(f, android.os.ParcelFileDescriptor.MODE_READ_ONLY);
                 android.graphics.pdf.PdfRenderer r = new android.graphics.pdf.PdfRenderer(fd)) {
                if (r.getPageCount() == 0) return;
                try (android.graphics.pdf.PdfRenderer.Page page = r.openPage(0)) {
                    // 1400 px wide, but never taller than 4000 px: a long statement page would otherwise not fit in memory
                    float scale = Math.min(Math.max(1f, 1400f / page.getWidth()), 4000f / page.getHeight());
                    Bitmap bmp = Bitmap.createBitmap((int) (page.getWidth() * scale), (int) (page.getHeight() * scale), Bitmap.Config.ARGB_8888);
                    bmp.eraseColor(android.graphics.Color.WHITE);
                    page.render(bmp, null, null, android.graphics.pdf.PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    try (OutputStream os = new FileOutputStream(f)) { bmp.compress(Bitmap.CompressFormat.PNG, 100, os); }
                }
            }
        } catch (Exception | OutOfMemoryError ignored) {
            // not a readable PDF (or too big to draw): the image reader will say so
        }
    }

    /** Copies shared images into app storage: the sender's read permission can expire. */
    private JSObject imagesShare(List<Uri> uris) throws Exception {
        JSArray paths = new JSArray();
        File dir = new File(getContext().getCacheDir(), "shared");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Could not create cache folder");
        int i = 0;
        for (Uri uri : uris) {
            File out = new File(dir, System.currentTimeMillis() + "_" + (i++) + ".img");
            try (InputStream in = getContext().getContentResolver().openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
                if (in == null) continue;
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            }
            pdfToImage(out);
            paths.put(Uri.fromFile(out).toString());
        }
        JSObject s = new JSObject();
        s.put("kind", "images");
        s.put("uris", paths);
        return s;
    }

    /** Shares that arrived before the web app was ready (e.g. the share that launched the app). */
    @PluginMethod
    public void takePendingShares(PluginCall call) {
        JSArray out = new JSArray();
        synchronized (pending) {
            for (JSObject s : pending) out.put(s);
            pending.clear();
        }
        JSObject ret = new JSObject();
        ret.put("shares", out);
        call.resolve(ret);
    }

    @PluginMethod
    public void ackShare(PluginCall call) {
        synchronized (pending) {
            pending.clear();
        }
        call.resolve();
    }

    /* ---------- OCR ---------- */

    /** { uri } (file:// or content://) or { base64 } → { text, lines: [{ text, top, left, height }] } */
    @PluginMethod
    public void ocr(PluginCall call) {
        worker.execute(() -> {
            try {
                InputImage image;
                String uri = call.getString("uri");
                String b64 = call.getString("base64");
                if (uri != null) {
                    image = InputImage.fromFilePath(getContext(), Uri.parse(uri)); // applies EXIF rotation
                } else if (b64 != null) {
                    byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                    Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                    if (bmp == null) { call.reject("Not an image"); return; }
                    image = InputImage.fromBitmap(bmp, 0);
                } else {
                    call.reject("uri or base64 is required");
                    return;
                }
                if (recognizer == null) recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
                if (devanagari == null) devanagari = TextRecognition.getClient(new DevanagariTextRecognizerOptions.Builder().build());
                final InputImage img = image;
                // "latin" asks for the English-only reader (comparison and fallback); the default reads Hindi and English
                boolean latinOnly = "latin".equals(call.getString("script"));
                (latinOnly ? recognizer : devanagari).process(img)
                        .addOnSuccessListener(result -> call.resolve(toJs(result)))
                        .addOnFailureListener(e -> recognizer.process(img)
                                .addOnSuccessListener(result -> call.resolve(toJs(result)))
                                .addOnFailureListener(e2 -> call.reject("Could not read text from the image", e2)));
            } catch (Exception e) {
                call.reject("Could not open the image", e);
            }
        });
    }

    private static JSObject toJs(Text result) {
        JSArray lines = new JSArray();
        for (Text.TextBlock block : result.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                JSObject l = new JSObject();
                l.put("text", line.getText());
                Rect r = line.getBoundingBox();
                l.put("top", r != null ? r.top : 0);
                l.put("left", r != null ? r.left : 0);
                l.put("height", r != null ? r.height() : 0);
                lines.put(l);
            }
        }
        JSObject ret = new JSObject();
        ret.put("text", result.getText());
        ret.put("lines", lines);
        return ret;
    }

    /* ---------- Gemini Nano (on-device LLM) ---------- */

    private GenerativeModelFutures nano() {
        if (nano == null) nano = GenerativeModelFutures.from(Generation.INSTANCE.getClient());
        return nano;
    }

    private static String statusName(int s) {
        if (s == FeatureStatus.AVAILABLE) return "available";
        if (s == FeatureStatus.DOWNLOADABLE) return "downloadable";
        if (s == FeatureStatus.DOWNLOADING) return "downloading";
        return "unavailable";
    }

    @PluginMethod
    public void nanoStatus(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            ret.put("status", "unavailable");
            call.resolve(ret);
            return;
        }
        try {
            ListenableFuture<Integer> f = nano().checkStatus();
            f.addListener(() -> {
                try {
                    ret.put("status", statusName(f.get()));
                } catch (Exception e) {
                    ret.put("status", "unavailable");
                    ret.put("reason", e.getMessage());
                }
                call.resolve(ret);
            }, worker);
        } catch (Throwable t) { // AICore missing on this phone
            ret.put("status", "unavailable");
            ret.put("reason", t.getMessage());
            call.resolve(ret);
        }
    }

    /** Starts the model download (done by the system, can take a while on Wi-Fi). Resolves when started. */
    @PluginMethod
    public void nanoDownload(PluginCall call) {
        try {
            nano().download(new DownloadCallback() {
                @Override
                public void onDownloadStarted(long bytesToDownload) {
                    JSObject ret = new JSObject();
                    ret.put("started", true);
                    ret.put("bytes", bytesToDownload);
                    call.resolve(ret);
                }

                @Override
                public void onDownloadFailed(GenAiException e) {
                    call.reject("Model download failed: " + e.getMessage());
                }

                @Override
                public void onDownloadCompleted() {
                    notifyListeners("nanoReady", new JSObject());
                }
            });
        } catch (Throwable t) {
            call.reject("On-device AI isn't supported on this phone");
        }
    }

    @PluginMethod
    public void nanoGenerate(PluginCall call) {
        String prompt = call.getString("prompt");
        if (prompt == null) { call.reject("prompt is required"); return; }
        try {
            ListenableFuture<GenerateContentResponse> f = nano().generateContent(prompt);
            f.addListener(() -> {
                try {
                    List<Candidate> c = f.get().getCandidates();
                    JSObject ret = new JSObject();
                    ret.put("text", c.isEmpty() ? "" : c.get(0).getText());
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("On-device AI failed: " + e.getMessage());
                }
            }, worker);
        } catch (Throwable t) {
            call.reject("On-device AI isn't supported on this phone");
        }
    }
}
