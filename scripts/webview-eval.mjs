// エミュレーター（や実機）のアプリの WebView で、式を評価して答えを出す（動作確認ページを押す道具）。
//
// 前の段取り（PowerShell なら $PID の代わりに数を直に書く）：
//   adb shell pidof com.nonahisa.novelai            → アプリの番号
//   adb forward tcp:9333 localabstract:webview_devtools_remote_<番号>
//
// 使い方：
//   node scripts/webview-eval.mjs "<押す式>" <待つミリ秒> "<読む式>"
// 例（7番のボタンを押し、8秒待って結果を読む）：
//   node scripts/webview-eval.mjs "document.querySelector('#abortRoute').click()" 8000 "document.querySelector('#abortResult').textContent"
//
// Node 22 以降（WebSocket が組み込み）。

const [action, waitMs = "0", read = action] = process.argv.slice(2);
if (!action) {
  console.error("押す式を渡してください");
  process.exit(2);
}
const pages = await (await fetch("http://localhost:9333/json")).json();
const page = pages.find((p) => p.type === "page") ?? pages[0];
if (!page) {
  console.error("WebView が見つかりません（adb forward を確かめる）");
  process.exit(1);
}
const sock = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const call = (method, params) =>
  new Promise((resolve) => {
    const my = ++id;
    sock.addEventListener("message", function onMessage(ev) {
      const message = JSON.parse(ev.data);
      if (message.id === my) {
        sock.removeEventListener("message", onMessage);
        resolve(message);
      }
    });
    sock.send(JSON.stringify({ id: my, method, params }));
  });
sock.addEventListener("open", async () => {
  await call("Runtime.evaluate", { expression: action, awaitPromise: true });
  await new Promise((r) => setTimeout(r, Number(waitMs)));
  const answer = await call("Runtime.evaluate", { expression: read, awaitPromise: true, returnByValue: true });
  console.log(answer.result?.result?.value ?? JSON.stringify(answer.result));
  sock.close();
});
