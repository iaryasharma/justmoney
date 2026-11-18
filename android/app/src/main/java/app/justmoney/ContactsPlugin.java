package app.justmoney;

import android.Manifest;
import android.database.Cursor;
import android.provider.ContactsContract;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Read-only access to the phone's contacts (name and phone numbers only), so a payment can be
 * linked to the person it went to or came from. Nothing is stored or sent anywhere from here:
 * the app keeps only the contacts the user chooses.
 */
@CapacitorPlugin(
    name = "Contacts",
    permissions = { @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS }) }
)
public class ContactsPlugin extends Plugin {

    @PluginMethod
    public void list(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "afterPermission");
            return;
        }
        load(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) load(call);
        else call.reject("Contacts permission was not granted");
    }

    private void load(PluginCall call) {
        new Thread(() -> {
            try {
                Map<String, JSObject> byId = new LinkedHashMap<>();
                String[] cols = {
                    ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER,
                };
                try (Cursor c = getContext().getContentResolver().query(
                        ContactsContract.CommonDataKinds.Phone.CONTENT_URI, cols, null, null,
                        ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " COLLATE NOCASE ASC")) {
                    if (c != null) {
                        while (c.moveToNext() && byId.size() < 6000) {
                            String id = c.getString(0);
                            String name = c.getString(1);
                            String number = c.getString(2);
                            if (id == null || name == null || name.trim().isEmpty()) continue;
                            JSObject o = byId.get(id);
                            if (o == null) {
                                o = new JSObject();
                                o.put("id", id);
                                o.put("name", name);
                                o.put("phones", new JSArray());
                                byId.put(id, o);
                            }
                            if (number != null) {
                                JSArray phones = (JSArray) o.get("phones");
                                phones.put(number);
                            }
                        }
                    }
                }
                JSArray out = new JSArray();
                for (JSObject o : byId.values()) out.put(o);
                JSObject ret = new JSObject();
                ret.put("contacts", out);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Could not read contacts: " + e.getMessage());
            }
        }).start();
    }
}
