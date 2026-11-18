package com.nonahisa.novelai;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * 画面から前面サービス（{@link AiWorkService}）を始める・進み具合を出す・止める口（`src/platform/backgroundWork.ts`）。
 *
 * 通知の許可（Android 13 から）は、初めて始めるときに訊く。断られても仕事は続ける（前面サービスは許可が無くても動き、
 * 通知の欄に出ないだけ）。
 */
@CapacitorPlugin(name = "AiWork", permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) })
public class AiWorkPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notifications") == PermissionState.PROMPT) {
            requestPermissionForAlias("notifications", call, "afterPermission");
            return;
        }
        send(call, true);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        send(call, true);
    }

    @PluginMethod
    public void update(PluginCall call) {
        send(call, false);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();
        context.stopService(new Intent(context, AiWorkService.class));
        call.resolve();
    }

    private void send(PluginCall call, boolean starting) {
        Context context = getContext();
        Intent intent = new Intent(context, AiWorkService.class);
        intent.putExtra(AiWorkService.EXTRA_TITLE, call.getString("title", "AI の処理"));
        intent.putExtra(AiWorkService.EXTRA_TEXT, call.getString("text", ""));
        intent.putExtra(AiWorkService.EXTRA_PROGRESS, call.getInt("progress", 0));
        intent.putExtra(AiWorkService.EXTRA_MAX, call.getInt("max", 0));
        try {
            if (starting) {
                ContextCompat.startForegroundService(context, intent);
            } else {
                // 進み具合だけを書き換える（サービスが動いていなければ何もしない）
                AiWorkService.ensureChannel(context);
                if (NotificationManagerCompat.from(context).areNotificationsEnabled()) {
                    NotificationManagerCompat.from(context).notify(AiWorkService.NOTIFICATION_ID, AiWorkService.build(context, intent));
                }
            }
            call.resolve();
        } catch (SecurityException | IllegalStateException error) {
            // 始められなくても、仕事は前面のあいだは続く（裏に回ると止まりうる）。画面へ訳を返す
            call.reject(error.getMessage());
        }
    }
}
