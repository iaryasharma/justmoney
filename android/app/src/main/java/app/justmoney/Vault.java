package app.justmoney;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Encrypts what JustMoney keeps in its database, so the data is unreadable even if the database file is copied off the phone
 * (a rooted phone, a forensic copy, another app that gets hold of the file).
 *
 * A random 256-bit data key encrypts every value (AES-256-GCM, a fresh IV each time, tied to the row it belongs to).
 * The data key is itself encrypted by a key that lives in the Android Keystore and never leaves it, so the data key is
 * only ever readable on this phone, by this app. If the Keystore is not available nothing is written in plain text: encrypt() throws
 * and the save is refused, so the app never keeps an unencrypted copy of the data.
 */
final class Vault {
    private static final String ALIAS = "justmoney_db_master";
    private static final String PREFS = "justmoney_vault";
    static final String TAG = "e1:";

    private static SecretKey dek;
    /** When the Keystore last failed. It is tried again a little later: one hiccup after boot must not lock the data away until restart. */
    private static long failedAt;

    private Vault() {}

    /** The data key, made on first use. Null when the Keystore cannot be used. */
    private static synchronized SecretKey key(Context ctx) {
        if (dek != null || System.currentTimeMillis() - failedAt < 3000) return dek;
        try {
            SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            SecretKey master;
            if (ks.containsAlias(ALIAS)) {
                master = ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
            } else {
                KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .build());
                master = kg.generateKey();
            }
            String wrapped = p.getString("dek", null);
            String iv = p.getString("iv", null);
            byte[] raw;
            if (wrapped != null && iv != null) {
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.DECRYPT_MODE, master, new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
                raw = c.doFinal(Base64.decode(wrapped, Base64.NO_WRAP));
            } else {
                raw = new byte[32];
                new SecureRandom().nextBytes(raw);
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.ENCRYPT_MODE, master);
                byte[] enc = c.doFinal(raw);
                // commit() so the key is on disk before any value is encrypted with it
                if (!p.edit().putString("dek", Base64.encodeToString(enc, Base64.NO_WRAP)).putString("iv", Base64.encodeToString(c.getIV(), Base64.NO_WRAP)).commit()) { failedAt = System.currentTimeMillis(); return null; }
            }
            dek = new SecretKeySpec(raw, "AES");
        } catch (Exception e) {
            dek = null;
            failedAt = System.currentTimeMillis();
        }
        return dek;
    }

    static boolean available(Context ctx) {
        return key(ctx) != null;
    }

    static boolean isEncrypted(String s) {
        return s != null && s.startsWith(TAG);
    }

    /** Thrown when a value cannot be encrypted: the save is refused rather than stored in plain text. */
    static final class Unavailable extends RuntimeException { Unavailable() { super("Encryption is not available on this phone, so nothing was saved"); } }

    /** Encrypts a value for the row named by `aad`. Throws Unavailable when there is no usable key or encryption fails: never returns the plain value. */
    static String encrypt(Context ctx, String aad, String plain) {
        if (plain == null) return null;
        SecretKey k = key(ctx);
        if (k == null) throw new Unavailable();
        try {
            byte[] iv = new byte[12];
            new SecureRandom().nextBytes(iv);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, k, new GCMParameterSpec(128, iv));
            c.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
            byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            return TAG + Base64.encodeToString(out, Base64.NO_WRAP);
        } catch (Exception e) {
            throw new Unavailable();
        }
    }

    /** Thrown when stored data exists but cannot be opened right now: callers stop instead of treating the database as empty. */
    static final class Locked extends RuntimeException { Locked() { super("Encrypted data could not be opened"); } }

    /** Like decrypt, but a value that cannot be opened stops the read (loading everything, backups). */
    static String decryptOrThrow(Context ctx, String aad, String stored) {
        String v = decrypt(ctx, aad, stored);
        if (v == null && isEncrypted(stored)) throw new Locked();
        return v;
    }

    /** Reads a value back. A value that was never encrypted (an older install) is returned as it is. Null if it cannot be opened. */
    static String decrypt(Context ctx, String aad, String stored) {
        if (!isEncrypted(stored)) return stored;
        SecretKey k = key(ctx);
        if (k == null) return null;
        try {
            byte[] all = Base64.decode(stored.substring(TAG.length()), Base64.NO_WRAP);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, all, 0, 12));
            c.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
            return new String(c.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }
}
