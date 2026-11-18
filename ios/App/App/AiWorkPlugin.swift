import UIKit
import Capacitor

/**
 長い AI の処理のあいだ、アプリを裏に回したときに iOS から数十秒の猶予をもらう口（Android の AiWorkPlugin と同じ名前「AiWork」）。

 iOS には Android の前面サービスが無く、裏に回ったアプリはすぐに止められる。`beginBackgroundTask` で猶予をもらうと、
 いま AI に頼んでいる1回（1区切り）を終わらせられる（2026-11-18 作者の答え「案A」）。続きを頼むかどうかは画面
 （`src/app/typoScreen.ts`）が決め、裏に回ったら次の区切りは頼まない。終わったら（成功でも失敗でも中止でも）画面が stop を呼ぶ。
 猶予が尽きたら iOS が呼ぶ後片付けで、ここで印を返す（返さないと、iOS がアプリを止める）。
 update は Android の通知の進み具合のためのもので、iOS では何もしない。
 */
@objc(AiWorkPlugin)
public class AiWorkPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AiWorkPlugin"
    public let jsName = "AiWork"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private var task: UIBackgroundTaskIdentifier = .invalid

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.endTask()
            // 口はアプリのあいだずっと生きているので、強く持ってよい（弱く持つと Swift 6 で警告。2026-11-18 Mac の組み立て）
            self.task = UIApplication.shared.beginBackgroundTask(withName: "ai-work") {
                self.endTask()
            }
            call.resolve()
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.endTask()
            call.resolve()
        }
    }

    private func endTask() {
        guard task != .invalid else { return }
        UIApplication.shared.endBackgroundTask(task)
        task = .invalid
    }
}
