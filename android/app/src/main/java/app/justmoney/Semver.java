package app.justmoney;

/** Compares version names such as "0.1.2" or "v0.1.2". A missing part counts as 0, and so does anything unreadable. */
final class Semver {
    private Semver() {}

    static int compare(String a, String b) {
        int[] x = parts(a), y = parts(b);
        for (int i = 0; i < 3; i++) {
            if (x[i] != y[i]) return Integer.compare(x[i], y[i]);
        }
        return 0;
    }

    private static int[] parts(String version) {
        int[] out = new int[3];
        String s = version == null ? "" : version.trim();
        if (s.startsWith("v") || s.startsWith("V")) s = s.substring(1);
        // "0.1.2-beta" and "0.1.2+build" compare as 0.1.2
        String[] p = s.split("[.+-]");
        for (int i = 0; i < 3 && i < p.length; i++) {
            try {
                out[i] = Integer.parseInt(p[i].replaceAll("\\D.*", ""));
            } catch (NumberFormatException e) {
                out[i] = 0;
            }
        }
        return out;
    }
}
