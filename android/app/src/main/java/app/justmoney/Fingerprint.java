package app.justmoney;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * A short, collision-resistant key for a captured message, stored in the database next to the encrypted text.
 * SHA-256 (truncated) instead of String.hashCode(): a 32-bit hash can collide, and it is cheap to guess for short messages.
 */
final class Fingerprint {
    private Fingerprint() {}

    static String of(String text) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(32);
            for (int i = 0; i < 16; i++) sb.append(String.format("%02x", d[i]));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 is always available", e);
        }
    }
}
