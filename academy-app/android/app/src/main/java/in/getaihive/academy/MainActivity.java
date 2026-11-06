package in.getaihive.academy;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;
import java.util.List;
import java.util.regex.Pattern;

// The members' app. Everything shown in this window is protected: screenshots, screen recordings, screen
// sharing and the recent-apps preview all come out black. A link to an academy (aihiveacademy://learn/<handle>,
// sent from the website's "Open in the app" button) opens that academy here.
public class MainActivity extends BridgeActivity {
    private static final Pattern HANDLE = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$");

    @Override
    public void onCreate(Bundle savedInstanceState) {
        lock();
        super.onCreate(savedInstanceState);
        lock();
        openFrom(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openFrom(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        lock(); // nothing may switch the protection off while the app is in use
    }

    private void lock() {
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) setRecentsScreenshotEnabled(false);
    }

    // aihiveacademy://learn/<handle> → the app's own home, which opens (or adds) that academy
    private void openFrom(Intent intent) {
        Uri u = intent == null ? null : intent.getData();
        if (u == null || !"aihiveacademy".equals(u.getScheme()) || getBridge() == null) return;
        List<String> parts = u.getPathSegments();
        String handle = "learn".equals(u.getHost()) && !parts.isEmpty() ? parts.get(0) : "";
        if (!HANDLE.matcher(handle).matches()) return;
        String target = "https://localhost/#open/" + handle.toLowerCase();
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(target));
    }
}
