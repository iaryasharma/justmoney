package app.justmoney;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import java.util.regex.Pattern;

/**
 * Reads a new text message the moment it arrives (needs the SMS permission), so a bank message is seen even when the messaging app
 * mutes it, filters it or never shows a notification. Only a message from a business sender that looks like a money movement is kept,
 * in the app's private database; every other message is ignored and never stored.
 */
public class SmsReceiver extends BroadcastReceiver {
    /**
     * Business senders are names ("VM-KOTAKB", "AX-UCOBNK"), not phone numbers. Since 2025 TRAI adds the message type at the end
     * ("AX-KOTAKB-S" service, "-T" transactional, "-P" promotional, "-G" government), so that suffix is allowed too.
     */
    private static final Pattern BUSINESS_SENDER = Pattern.compile("(?i)^[A-Z0-9]{2}-?[A-Z0-9&]{3,9}(-[A-Z])?$|^[A-Z][A-Z0-9]{4,10}$");

    static boolean fromBusiness(String sender) {
        if (sender == null) return false;
        String s = sender.trim();
        // "-P" senders are promotional by TRAI's rules: offers and adverts, never money that moved
        return BUSINESS_SENDER.matcher(s).find() && !s.matches("^\\+?[0-9]{6,}$") && !s.toUpperCase().endsWith("-P");
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
            SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
            if (parts == null || parts.length == 0) return;
            StringBuilder body = new StringBuilder();
            for (SmsMessage m : parts) body.append(m.getMessageBody());
            String sender = parts[0].getOriginatingAddress();
            long ts = parts[0].getTimestampMillis();
            String text = body.toString();
            if (!fromBusiness(sender) || !PaymentNotificationListener.looksLikePayment(text)) return;
            // stored off the main thread; goAsync keeps the receiver alive until it is saved
            final PendingResult pending = goAsync();
            final Context ctx = context.getApplicationContext();
            final long at = ts > 0 ? ts : System.currentTimeMillis();
            PaymentNotificationListener.IO.execute(() -> {
                try {
                    boolean added = JustMoneyDb.get(ctx).addCaptured("sms:" + sender, sender, text, at);
                    PaymentNotificationListener.Callback cb = PaymentNotificationListener.callback;
                    if (added && cb != null) cb.onCaptured();
                } catch (Exception ignored) {
                } finally {
                    pending.finish();
                }
            });
        } catch (Exception ignored) {
            // never let a malformed message crash the receiver
        }
    }
}
