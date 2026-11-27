package com.nonahisa.novelai;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * 端末の読み上げ（TextToSpeech）で1文ずつ読む口（`src/platform/speech.ts` の NativeSpeaker。本体の設計書 6.42）。
 *
 * Android の WebView には speechSynthesis が無いので、ここで端末の声を使う。日本語の声だけで読む
 * （日本語が使えなければ check が available: false を返し、画面は押せなくして訳を出す）。
 * 声を出すだけで、本文はどこにも送らない・残さない。
 */
@CapacitorPlugin(name = "ReadAloud")
public class ReadAloudPlugin extends Plugin {

    private TextToSpeech tts;
    /** 用意ができたか（null：まだ、true：日本語で読める、false：読めない） */
    private Boolean ready;
    private final List<Runnable> waiting = new ArrayList<>();
    /** いま読んでいる文の印と、読み終えたら返す呼び出し */
    private String currentId;
    private PluginCall currentCall;

    private void whenReady(Runnable then) {
        if (ready != null) {
            then.run();
            return;
        }
        waiting.add(then);
        if (tts != null) return;
        tts = new TextToSpeech(getContext(), status -> {
            boolean ok = false;
            if (status == TextToSpeech.SUCCESS) {
                int result = tts.setLanguage(Locale.JAPAN);
                ok = result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED;
            }
            ready = ok;
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String utteranceId) {}

                @Override
                public void onDone(String utteranceId) {
                    finish(utteranceId, "done");
                }

                @Override
                public void onError(String utteranceId) {
                    finish(utteranceId, "stopped");
                }

                @Override
                public void onStop(String utteranceId, boolean interrupted) {
                    finish(utteranceId, "stopped");
                }
            });
            List<Runnable> run = new ArrayList<>(waiting);
            waiting.clear();
            for (Runnable r : run) r.run();
        });
    }

    private synchronized void finish(String utteranceId, String end) {
        if (currentCall == null || !utteranceId.equals(currentId)) return;
        PluginCall call = currentCall;
        currentCall = null;
        currentId = null;
        JSObject result = new JSObject();
        result.put("end", end);
        call.resolve(result);
    }

    @PluginMethod
    public void check(PluginCall call) {
        whenReady(() -> {
            JSObject result = new JSObject();
            result.put("available", Boolean.TRUE.equals(ready));
            call.resolve(result);
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        float rate = call.getFloat("rate", 1.0f);
        whenReady(() -> {
            if (!Boolean.TRUE.equals(ready)) {
                call.reject("日本語の読み上げの声がありません");
                return;
            }
            synchronized (this) {
                // 前の文がまだなら止めた扱いにする（同時に2つの呼び出しを持たない）
                if (currentCall != null) finish(currentId, "stopped");
                currentId = UUID.randomUUID().toString();
                currentCall = call;
            }
            tts.setSpeechRate(rate);
            int queued = tts.speak(text, TextToSpeech.QUEUE_FLUSH, new Bundle(), currentId);
            if (queued != TextToSpeech.SUCCESS) finish(currentId, "stopped");
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) tts.stop();
        synchronized (this) {
            if (currentCall != null) finish(currentId, "stopped");
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
    }
}
