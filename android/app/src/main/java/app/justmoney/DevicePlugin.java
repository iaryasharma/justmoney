package app.justmoney;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.speech.RecognizerIntent;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import androidx.activity.result.ActivityResult;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;

/** Device features the WebView can't provide: biometric unlock, speech-to-text, screenshot blocking. */
@CapacitorPlugin(name = "Device")
public class DevicePlugin extends Plugin {
    /** Fingerprint/face (any class), falling back to the device PIN, pattern or password. Works on all API levels. */
    private static final int AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_WEAK
            | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    /* ---------- biometric lock ---------- */

    @PluginMethod
    public void biometricStatus(PluginCall call) {
        BiometricManager bm = BiometricManager.from(getContext());
        int any = bm.canAuthenticate(AUTHENTICATORS);
        int bio = bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK);
        JSObject ret = new JSObject();
        // available: something (biometric or screen lock) can verify the user
        ret.put("available", any == BiometricManager.BIOMETRIC_SUCCESS);
        // biometricEnrolled: a fingerprint/face is set up (otherwise only the device PIN will be asked)
        ret.put("biometricEnrolled", bio == BiometricManager.BIOMETRIC_SUCCESS);
        ret.put("reason", reason(any));
        call.resolve(ret);
    }

    private static String reason(int code) {
        switch (code) {
            case BiometricManager.BIOMETRIC_SUCCESS: return "ok";
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED: return "Set up a screen lock or fingerprint in your phone's settings first.";
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE: return "This phone has no biometric hardware.";
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE: return "Biometric hardware is unavailable right now.";
            default: return "Biometric unlock isn't available on this phone.";
        }
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        String title = call.getString("title", "Unlock JustMoney");
        String subtitle = call.getString("subtitle", "Confirm it's you to see your finances");
        Activity activity = getActivity();
        if (!(activity instanceof FragmentActivity)) {
            call.reject("Biometric prompt needs a FragmentActivity");
            return;
        }
        activity.runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt((FragmentActivity) activity, ContextCompat.getMainExecutor(activity),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                            JSObject ret = new JSObject();
                            ret.put("success", true);
                            call.resolve(ret);
                        }

                        @Override
                        public void onAuthenticationError(int code, @NonNull CharSequence msg) {
                            // Covers cancel, too many attempts and lockout; a single failed scan only
                            // calls onAuthenticationFailed and the prompt stays open for another try.
                            JSObject ret = new JSObject();
                            ret.put("success", false);
                            ret.put("code", code);
                            ret.put("message", msg.toString());
                            call.resolve(ret);
                        }
                    });
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setAllowedAuthenticators(AUTHENTICATORS)
                    .build();
            prompt.authenticate(info);
        });
    }

    /* ---------- system bars: same colour as the app background ---------- */

    /** { color: "#000000", lightBackground: false } — paints the status/navigation bar areas and sets icon colours. */
    @PluginMethod
    public void setSystemBars(PluginCall call) {
        String color = call.getString("color", "#000000");
        boolean light = Boolean.TRUE.equals(call.getBoolean("lightBackground", false));
        getActivity().runOnUiThread(() -> {
            try {
                int c = Color.parseColor(color);
                Window w = getActivity().getWindow();
                w.getDecorView().setBackgroundColor(c);
                View content = w.findViewById(android.R.id.content);
                if (content != null) content.setBackgroundColor(c);
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().setBackgroundColor(c);
                    if (getBridge().getWebView().getParent() instanceof View) ((View) getBridge().getWebView().getParent()).setBackgroundColor(c);
                }
                if (Build.VERSION.SDK_INT < 35) { // Android 15+ ignores these (edge-to-edge); the backgrounds above cover it
                    w.setStatusBarColor(c);
                    w.setNavigationBarColor(c);
                }
                WindowInsetsControllerCompat ic = WindowCompat.getInsetsController(w, w.getDecorView());
                ic.setAppearanceLightStatusBars(light);
                ic.setAppearanceLightNavigationBars(light);
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not set the system bar colour: " + e.getMessage());
            }
        });
    }

    /* ---------- privacy: hide from recents and block screenshots ---------- */

    @PluginMethod
    public void setSecure(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }

    /** Android 13+: the recent-apps picture is not saved, but screenshots still work. Older versions rely on the in-app cover. */
    @PluginMethod
    public void setRecentsHidden(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT >= 33) {
            getActivity().runOnUiThread(() -> { getActivity().setRecentsScreenshotEnabled(!on); ret.put("supported", true); call.resolve(ret); });
        } else {
            ret.put("supported", false);
            call.resolve(ret);
        }
    }

    /** What the phone itself does to protect the data: a screen lock (the key that guards the data sits behind it), root, and USB debugging. */
    @PluginMethod
    public void deviceSecurity(PluginCall call) {
        JSObject ret = new JSObject();
        android.app.KeyguardManager km = (android.app.KeyguardManager) getContext().getSystemService(android.content.Context.KEYGUARD_SERVICE);
        ret.put("screenLock", km != null && km.isDeviceSecure());
        boolean root = false;
        String[] paths = {"/system/bin/su", "/system/xbin/su", "/sbin/su", "/su/bin/su", "/system/app/Superuser.apk", "/data/local/xbin/su", "/data/local/bin/su"};
        for (String p : paths) if (new java.io.File(p).exists()) { root = true; break; }
        String tags = Build.TAGS;
        if (tags != null && tags.contains("test-keys")) root = true;
        ret.put("rooted", root);
        ret.put("usbDebugging", android.provider.Settings.Global.getInt(getContext().getContentResolver(), android.provider.Settings.Global.ADB_ENABLED, 0) == 1);
        call.resolve(ret);
    }

    /* ---------- speech to text (system recogniser; no microphone permission needed) ---------- */

    @PluginMethod
    public void recognizeSpeech(PluginCall call) {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("language", "en-IN"));
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, call.getString("prompt", "Say it like: paid 500 to Swiggy"));
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try {
            startActivityForResult(call, intent, "onSpeechResult");
        } catch (ActivityNotFoundException e) {
            call.reject("No speech recogniser is installed on this phone (install or enable Google app / Speech Services).");
        }
    }

    @ActivityCallback
    private void onSpeechResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        String text = null;
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            ArrayList<String> matches = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (matches != null && !matches.isEmpty()) text = matches.get(0);
        }
        ret.put("text", text);
        call.resolve(ret);
    }
}
