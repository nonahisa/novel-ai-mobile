package com.nonahisa.novelai;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
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
    /** いま当てている声の名前（空は決まりの声）。文ごとに当て直さない（当て直すと文の頭が遅れる端末がある） */
    private String chosenVoice = "";

    private void whenReady(Runnable then) {
        synchronized (this) {
            if (ready == null) {
                waiting.add(then);
                if (tts == null) {
                    // 初期化の知らせは、組み立ての途中（tts に入る前）に届くことがある（読み上げの部品が1つも無い端末）。
                    // 組み立てが終わってから扱うよう、メインの順番待ちへ回す
                    Handler main = new Handler(Looper.getMainLooper());
                    tts = new TextToSpeech(getContext(), status -> main.post(() -> initialized(status)));
                }
                return;
            }
        }
        then.run();
    }

    private void initialized(int status) {
        boolean ok = false;
        TextToSpeech engine;
        synchronized (this) {
            engine = tts;
        }
        if (status == TextToSpeech.SUCCESS && engine != null) {
            int result = engine.setLanguage(Locale.JAPAN);
            ok = result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED;
            // 聞き手は使えるときだけ付ける（失敗のときは engine が使えない）
            if (ok) {
                engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
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
            }
        }
        List<Runnable> run;
        synchronized (this) {
            ready = ok;
            run = new ArrayList<>(waiting);
            waiting.clear();
        }
        for (Runnable r : run) r.run();
    }

    private synchronized void finish(String utteranceId, String end) {
        if (currentCall == null || utteranceId == null || !utteranceId.equals(currentId)) return;
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

    /** 日本語の声（［設定］→［読み上げ］で選ぶ）。名前と、ネットが要るか。名前の順に並べる */
    @PluginMethod
    public void voices(PluginCall call) {
        whenReady(() -> {
            JSArray list = new JSArray();
            TextToSpeech engine;
            synchronized (this) {
                engine = tts;
            }
            if (Boolean.TRUE.equals(ready) && engine != null) {
                List<Voice> found = new ArrayList<>();
                Set<Voice> all = null;
                try {
                    all = engine.getVoices();
                } catch (RuntimeException ignored) {
                    // 声の一覧を返せない読み上げの部品がある。一覧は空で返す（決まりの声では読める）
                }
                if (all != null) {
                    for (Voice voice : all) {
                        if (voice.getLocale() != null && "ja".equals(voice.getLocale().getLanguage())) found.add(voice);
                    }
                }
                found.sort((a, b) -> a.getName().compareTo(b.getName()));
                for (Voice voice : found) {
                    JSObject item = new JSObject();
                    item.put("name", voice.getName());
                    item.put("network", voice.isNetworkConnectionRequired());
                    list.put(item);
                }
            }
            JSObject result = new JSObject();
            result.put("voices", list);
            call.resolve(result);
        });
    }

    /** 名前の声に替える。空・見つからなければ端末の決まりの日本語の声に戻す（前に選んだ声が残らないように毎回決める） */
    private void chooseVoice(TextToSpeech engine, String name) {
        String wanted = name == null ? "" : name;
        if (wanted.equals(chosenVoice)) return;
        chosenVoice = wanted;
        if (name != null && !name.isEmpty()) {
            try {
                Set<Voice> all = engine.getVoices();
                if (all != null) {
                    for (Voice voice : all) {
                        if (name.equals(voice.getName())) {
                            if (engine.setVoice(voice) == TextToSpeech.SUCCESS) return;
                            break;
                        }
                    }
                }
            } catch (RuntimeException ignored) {
                // 下の決まりの声へ
            }
        }
        engine.setLanguage(Locale.JAPAN);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        float rate = call.getFloat("rate", 1.0f);
        String voiceName = call.getString("voice", "");
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
            TextToSpeech engine;
            String id;
            synchronized (this) {
                engine = tts;
                id = currentId;
            }
            if (engine == null) {
                finish(id, "stopped");
                return;
            }
            chooseVoice(engine, voiceName);
            engine.setSpeechRate(rate);
            int queued = engine.speak(text, TextToSpeech.QUEUE_FLUSH, new Bundle(), id);
            if (queued != TextToSpeech.SUCCESS) finish(id, "stopped");
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
        TextToSpeech engine;
        synchronized (this) {
            engine = tts;
            tts = null;
            ready = null;
        }
        if (engine != null) {
            engine.stop();
            engine.shutdown();
        }
    }
}
