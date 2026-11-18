package app.justmoney;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After the phone restarts, brings the pinned quick-add notification back if the user had it on. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) && QuickAddService.wanted(context)) QuickAddService.apply(context, true);
    }
}
