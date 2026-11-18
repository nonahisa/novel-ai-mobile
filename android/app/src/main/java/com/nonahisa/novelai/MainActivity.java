package com.nonahisa.novelai;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // アプリの中に置いた口（長い AI の処理を裏でも続ける。AiWorkPlugin）
        registerPlugin(AiWorkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
