package com.nonahisa.novelai;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * 長い AI の処理のあいだ、アプリを裏に回しても続けるための前面サービス（設計書 7章。作者の決定 2026-10-31「続ける」）。
 *
 * 仕事そのもの（AI を呼ぶ・指摘を書く）は画面（WebView の JavaScript）が続ける。Capacitor は裏に回っても WebView を
 * 止めないが、Android は裏のプロセスを凍らせたり止めたりする。前面サービスがあるあいだは、プロセスは前面の扱いになり、
 * 凍らせられない。通知に進み具合（「AI に見せています 3/12」）を出し、押すとアプリへ戻る。
 * 仕事が終わったら（成功でも失敗でも中止でも）画面が止める。
 */
public class AiWorkService extends Service {
    static final String CHANNEL_ID = "ai-work";
    static final int NOTIFICATION_ID = 7;
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_TEXT = "text";
    static final String EXTRA_PROGRESS = "progress";
    static final String EXTRA_MAX = "max";

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureChannel(this);
        Notification notification = build(this, intent);
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type);
        // 止められても、作り直さない（仕事は画面が持っているので、サービスだけ戻っても意味がない）
        return START_NOT_STICKY;
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        // Android 15 の dataSync の時間切れ（1日に6時間）。仕事の続きは画面に任せ、ここは降りる
        stopSelf();
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        // 音も振動も出さない（進み具合を見せるだけ）
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "AI の処理", NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    static Notification build(Context context, Intent intent) {
        String title = intent != null && intent.getStringExtra(EXTRA_TITLE) != null ? intent.getStringExtra(EXTRA_TITLE) : "AI の処理";
        String text = intent != null && intent.getStringExtra(EXTRA_TEXT) != null ? intent.getStringExtra(EXTRA_TEXT) : "";
        int progress = intent != null ? intent.getIntExtra(EXTRA_PROGRESS, 0) : 0;
        int max = intent != null ? intent.getIntExtra(EXTRA_MAX, 0) : 0;
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(tap)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS);
        if (max > 0) builder.setProgress(max, Math.min(progress, max), false);
        return builder.build();
    }
}
