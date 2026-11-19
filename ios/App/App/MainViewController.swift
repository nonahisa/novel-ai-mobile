import UIKit
import WebKit
import Capacitor

/**
 アプリの中に置いた口（Capacitor のプラグイン）を登録するための画面の土台（Capacitor 6 からの登録の仕方）。
 いまは AiWorkPlugin（長い AI の処理のあいだの裏の猶予）だけ。SceneDelegate と Main.storyboard がこれを使う。

 試しの記録：起動の引数に `-novelaiTouchTrace` があるときだけ、押しの道筋（`window.__novelaiTapTrace` の行。位置の数と
 要素の名前だけで、本文は入らない）を端末の記録（NSLog）にも出す。Mac が Safari の Web インスペクタなしで読むため
 （`xcrun simctl launch --console-pty booted com.nonahisa.novelai -novelaiTouchTrace`、または UI テストの
 `app.launchArguments = ["-novelaiTouchTrace"]` と `log stream --predicate 'eventMessage CONTAINS "[novelai-touch]"'`）。
 引数が無ければ何も足さない（Capacitor の記録は切ったまま）
 */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AiWorkPlugin())
        if ProcessInfo.processInfo.arguments.contains("-novelaiTouchTrace"), let controller = bridge?.webView?.configuration.userContentController {
            controller.addUserScript(WKUserScript(source: "window.__novelaiTouchTraceOn = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
            controller.add(TouchTraceHandler(), name: "novelaiTouchTrace")
        }
    }
}

/** 押しの道筋の1行を、端末の記録へ */
final class TouchTraceHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let line = message.body as? String else { return }
        NSLog("[novelai-touch] %@", line as NSString)
    }
}
