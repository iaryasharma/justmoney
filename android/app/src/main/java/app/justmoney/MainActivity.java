package app.justmoney;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(JustMoneyDbPlugin.class);
        registerPlugin(DevicePlugin.class);
        registerPlugin(CapturePlugin.class);
        registerPlugin(ContactsPlugin.class);
        registerPlugin(UpdaterPlugin.class);
        super.onCreate(savedInstanceState);
        // Keep the daily background backup scheduled (no-op if already scheduled or turned off).
        BackupWorker.schedule(this, BackupWriter.isEnabled(this));
        UpdateWorker.schedule(this, UpdaterPlugin.prefs(this).getBoolean("daily", true));
        PayoutWorker.schedule(this);
    }

    @Override
    public void onResume() {
        super.onResume();
        // payments only reach the app while the notification listener is bound: reconnect it if the system dropped it
        PaymentNotificationListener.ensureBound(this);
    }
}
