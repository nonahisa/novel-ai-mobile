package com.nonahisa.novelai;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * **新しい版の APK を取り寄せて照らし、端末のインストーラーへ渡す口**（更新の仕組み（3）。`src/platform/appInstaller.ts`。引継ぎ書 156章）。
 *
 * - 取り寄せるのは、このリポジトリの Release の下（{@link #PREFIX}）の物だけ。https のまま転送をたどる（GitHub の置き場へ）
 * - 書きながら SHA-256 と大きさを数え、札の値と合わなければ消して止める（MISMATCH）
 * - 中の製品の名前がこのアプリでない・版の番号が今より新しくなければ消して止める（WRONG_PACKAGE）
 * - 合えば端末のインストーラーを開く。入れるかどうかは作者が端末の画面で決める（勝手には入れない）
 * - 置き場はアプリのキャッシュの `updates/`（作品の外）。次に取り寄せるときに前の物を消す
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    static final String PREFIX = "https://github.com/nonahisa/novel-ai-mobile/releases/download/";

    @PluginMethod
    public void canInstall(PluginCall call) {
        boolean allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
        JSObject result = new JSObject();
        result.put("allowed", allowed);
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url", "");
        String want = call.getString("sha256", "");
        long bytes = call.getData().optLong("bytes", -1L); // 小さな数は Integer で届くので getLong では読めない
        String name = call.getString("name", "update.apk");
        if (!url.startsWith(PREFIX) || !want.matches("[0-9a-f]{64}") || bytes <= 0 || !name.matches("[A-Za-z0-9._-]+\\.apk")) {
            call.reject("札の中身が足りません", "BAD_TICKET");
            return;
        }
        new Thread(() -> {
            File dir = new File(getContext().getCacheDir(), "updates");
            File file = new File(dir, name);
            try {
                deleteAll(dir);
                if (!dir.mkdirs() && !dir.isDirectory()) throw new IllegalStateException("置き場を作れない");
                String got = download(url, file, bytes);
                if (!got.equals(want) || file.length() != bytes) {
                    deleteAll(dir);
                    call.reject("届いた中身が札と合いません", "MISMATCH");
                    return;
                }
                if (!isNewerSelf(file)) {
                    deleteAll(dir);
                    call.reject("このアプリの新しい版ではありません", "WRONG_PACKAGE");
                    return;
                }
                openInstaller(file);
                call.resolve();
            } catch (Exception e) {
                deleteAll(dir);
                call.reject("取り寄せられませんでした", "FAILED");
            }
        }).start();
    }

    /** 取り寄せて書き、SHA-256 を返す。札の大きさを超えたら止める */
    private String download(String url, File file, long limit) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(60_000);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
            if (!"https".equals(connection.getURL().getProtocol())) throw new IllegalStateException("https でない");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0;
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(file)) {
                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = in.read(buffer)) > 0) {
                    total += n;
                    if (total > limit) throw new IllegalStateException("大きすぎる");
                    digest.update(buffer, 0, n);
                    out.write(buffer, 0, n);
                }
            }
            StringBuilder hex = new StringBuilder();
            for (byte b : digest.digest()) hex.append(String.format("%02x", b));
            return hex.toString();
        } finally {
            connection.disconnect();
        }
    }

    /** 中の製品の名前がこのアプリで、版の番号が今より大きいか（署名の照らしは端末のインストーラーがする） */
    private boolean isNewerSelf(File file) throws PackageManager.NameNotFoundException {
        PackageManager pm = getContext().getPackageManager();
        PackageInfo archive = pm.getPackageArchiveInfo(file.getAbsolutePath(), 0);
        if (archive == null || !getContext().getPackageName().equals(archive.packageName)) return false;
        PackageInfo installed = pm.getPackageInfo(getContext().getPackageName(), 0);
        return versionCode(archive) > versionCode(installed);
    }

    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    private void openInstaller(File file) {
        Context context = getContext();
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    private static void deleteAll(File dir) {
        File[] files = dir.listFiles();
        if (files != null) for (File f : files) f.delete();
    }
}
