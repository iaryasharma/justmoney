package app.justmoney;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class SemverTest {
    @Test
    public void newerPatchMinorAndMajorAreNewer() {
        assertTrue(Semver.compare("0.1.2", "0.1.1") > 0);
        assertTrue(Semver.compare("0.2.0", "0.1.9") > 0);
        assertTrue(Semver.compare("1.0.0", "0.9.9") > 0);
    }

    @Test
    public void olderIsNotNewer() {
        assertTrue(Semver.compare("0.1.0", "0.1.1") < 0);
    }

    @Test
    public void sameVersionIsEqualWhateverThePrefix() {
        assertEquals(0, Semver.compare("v0.1.1", "0.1.1"));
    }

    @Test
    public void missingPartsCountAsZeroAndSuffixesAreIgnored() {
        assertEquals(0, Semver.compare("v1.2", "1.2.0"));
        assertTrue(Semver.compare("1.2.1-beta", "1.2.0") > 0);
        assertEquals(0, Semver.compare("1.2.0-rc1", "1.2.0"));
    }
}
