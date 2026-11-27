package com.nonahisa.novelai;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // アプリの中に置いた口（長い AI の処理を裏でも続ける。AiWorkPlugin）
        registerPlugin(AiWorkPlugin.class);
        // 新しい版を取り寄せて照らし、端末のインストーラーへ渡す口（AppUpdatePlugin。引継ぎ書 156章）
        registerPlugin(AppUpdatePlugin.class);
        // 端末の読み上げ（TextToSpeech）で原稿を読む口（ReadAloudPlugin。本体の設計書 6.42）
        registerPlugin(ReadAloudPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
