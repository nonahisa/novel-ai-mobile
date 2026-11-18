import UIKit
import Capacitor

/**
 アプリの中に置いた口（Capacitor のプラグイン）を登録するための画面の土台（Capacitor 6 からの登録の仕方）。
 いまは AiWorkPlugin（長い AI の処理のあいだの裏の猶予）だけ。SceneDelegate と Main.storyboard がこれを使う
 */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AiWorkPlugin())
    }
}
