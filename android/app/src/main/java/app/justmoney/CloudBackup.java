package app.justmoney;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Encrypted copy of the daily backup in a location the user picked with the
 * system file picker (e.g. Google Drive). The file is AES-256-GCM encrypted with
 * a key derived from the user's password (PBKDF2-SHA256); that derived key is kept
 * on the phone wrapped by an Android Keystore key, so the daily job can encrypt
 * without asking, while the password itself is never stored.
 *
 * File format (JSON): { app, format: "justmoney-encrypted", version, cipher, kdf,
 * iterations, salt, iv, data, exportedAt } — data is ciphertext||tag in base64.
 */
public final class CloudBackup {
    static final int ITERATIONS = 210_000;
    private static final String WRAP_ALIAS = "justmoney_cloud_backup_wrap";

    private CloudBackup() {}

    static SharedPreferences prefs(Context ctx) {
        return BackupWriter.prefs(ctx);
    }

    /** The cloud copy is always encrypted. It is only written once a backup password has been set. */
    public static boolean configured(Context ctx) {
        SharedPreferences p = prefs(ctx);
        return p.getString("cloudUri", null) != null && p.getString("cloudKeyEnc", null) != null;
    }

    /** Google Drive schedule, like WhatsApp: daily (default), weekly, monthly, or manual ("Only when I tap Back up"). */
    public static String frequency(Context ctx) {
        return prefs(ctx).getString("cloudFrequency", "daily");
    }

    public static boolean due(Context ctx) {
        String f = frequency(ctx);
        long day = 24L * 60 * 60 * 1000;
        long gap = "weekly".equals(f) ? 7 * day : "monthly".equals(f) ? 30 * day : "daily".equals(f) ? day : Long.MAX_VALUE;
        if (gap == Long.MAX_VALUE) return false;
        // a couple of hours of slack so a daily job that runs slightly early still counts
        return System.currentTimeMillis() - prefs(ctx).getLong("cloudLastAt", 0) >= gap - 2 * 60 * 60 * 1000;
    }

    private static SecretKey wrapKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(WRAP_ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(WRAP_ALIAS, null)).getSecretKey();
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(WRAP_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return kg.generateKey();
    }

    /** Derives the file key from the password (slow by design) and keeps it wrapped by the Keystore. */
    public static void setPassword(Context ctx, String password) throws Exception {
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, 256);
        byte[] derived = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        spec.clearPassword();
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, wrapKey());
        byte[] enc = c.doFinal(derived);
        prefs(ctx).edit()
                .putString("cloudSalt", b64(salt))
                .putString("cloudKeyEnc", b64(enc))
                .putString("cloudKeyIv", b64(c.getIV()))
                // the same password also protects the backup kept on the phone
                .putString("bkSalt", b64(salt))
                .putString("bkKeyEnc", b64(enc))
                .putString("bkKeyIv", b64(c.getIV()))
                .apply();
    }

    /** True when `password` is the one the backups are protected with now. */
    public static boolean verifyPassword(Context ctx, String password) {
        try {
            SharedPreferences p = prefs(ctx);
            String which = p.contains("bkKeyEnc") ? "bk" : "cloud";
            byte[] salt = unb64(p.getString(which + "Salt", ""));
            PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, 256);
            byte[] derived = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
            spec.clearPassword();
            return java.security.MessageDigest.isEqual(derived, fileKey(ctx, which));
        } catch (Exception e) {
            return false;
        }
    }

    private static byte[] fileKey(Context ctx) throws Exception {
        return fileKey(ctx, "cloud");
    }

    /** `which` is "cloud" or "bk" (the copy kept on the phone): the same password, kept separately so turning the cloud copy off does not unprotect the other. */
    private static byte[] fileKey(Context ctx, String which) throws Exception {
        SharedPreferences p = prefs(ctx);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, wrapKey(), new GCMParameterSpec(128, unb64(p.getString(which + "KeyIv", ""))));
        return c.doFinal(unb64(p.getString(which + "KeyEnc", "")));
    }

    /** The backup on this phone is encrypted whenever a backup password has been set. */
    public static boolean localProtected(Context ctx) {
        return prefs(ctx).getString("bkKeyEnc", null) != null;
    }

    /** The same file format as the cloud copy, for the file in Documents/JustMoney. */
    static String encryptLocal(Context ctx, byte[] plain) throws Exception {
        return encrypt(ctx, plain, "bk");
    }

    static String encrypt(Context ctx, byte[] plain) throws Exception {
        return encrypt(ctx, plain, "cloud");
    }

    static String encrypt(Context ctx, byte[] plain, String which) throws Exception {
        byte[] iv = new byte[12];
        new SecureRandom().nextBytes(iv);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(fileKey(ctx, which), "AES"), new GCMParameterSpec(128, iv));
        byte[] ct = c.doFinal(plain);
        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        JSONObject o = new JSONObject();
        o.put("app", "JustMoney");
        o.put("format", "justmoney-encrypted");
        o.put("version", 1);
        o.put("cipher", "AES-256-GCM");
        o.put("kdf", "PBKDF2-SHA256");
        o.put("iterations", ITERATIONS);
        o.put("salt", prefs(ctx).getString(which + "Salt", ""));
        o.put("iv", b64(iv));
        o.put("data", b64(ct));
        o.put("exportedAt", iso.format(new Date()));
        return o.toString();
    }

    /** Overwrites the chosen file with the encrypted backup. Nothing is written until a password is set. Records the outcome. */
    public static void write(Context ctx, byte[] plainBackup) {
        SharedPreferences p = prefs(ctx);
        if (!configured(ctx)) return;
        try {
            byte[] out = encrypt(ctx, plainBackup).getBytes(StandardCharsets.UTF_8);
            writeTo(ctx, Uri.parse(p.getString("cloudUri", "")), out);
            p.edit().putLong("cloudLastAt", System.currentTimeMillis()).remove("cloudError").apply();
        } catch (Exception e) {
            p.edit().putString("cloudError", e.getMessage() != null ? e.getMessage() : e.toString()).apply();
        }
    }

    /** Replaces the content of a document picked through the system file picker. */
    public static void writeTo(Context ctx, Uri uri, byte[] bytes) throws Exception {
        ContentResolver cr = ctx.getContentResolver();
        Exception last = null;
        // providers differ in which modes they accept; plain "w" is not tried: on some it keeps the old file's tail and corrupts the backup
        for (String mode : new String[]{"rwt", "wt"}) {
            try (OutputStream os = cr.openOutputStream(uri, mode)) {
                if (os == null) continue;
                os.write(bytes);
                return;
            } catch (Exception e) {
                last = e;
            }
        }
        throw last != null ? last : new IllegalStateException("Could not open the backup location");
    }

    public static void disable(Context ctx) {
        prefs(ctx).edit().remove("cloudUri").remove("cloudName").remove("cloudProvider").remove("cloudKeyEnc").remove("cloudKeyIv")
                .remove("cloudSalt").remove("cloudLastAt").remove("cloudError").remove("cloudEncrypt").apply(); // cloudEncrypt: a flag from older versions
    }

    private static String b64(byte[] b) { return Base64.encodeToString(b, Base64.NO_WRAP); }
    private static byte[] unb64(String s) { return Base64.decode(s, Base64.NO_WRAP); }
}
