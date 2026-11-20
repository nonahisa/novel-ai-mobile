// 更新の札 update.json と Release ノートを作る（引継ぎ書 155章。共通の決まりは統合の docs/更新の仕組み_共通.md）。
// 使い方（CI の release.yml から）：node scripts/updateTicket.mjs <版> <APK のファイル> <出す所のフォルダー>
//   → <出す所>/update.json と <出す所>/release-notes.md を書き、APK を novel-ai-mobile-<版>.apk の名前で写す
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PRODUCT = "novel-ai-mobile";
export const REPO = "nonahisa/novel-ai-mobile";

/** 「## <版>」「## <版>（日付）」の見出しか */
function isHeading(line, version) {
  if (!line.startsWith("## ")) return false;
  const rest = line.slice(3).trim();
  if (!rest.startsWith(version)) return false;
  const after = rest.slice(version.length);
  return after === "" || after.startsWith("（") || after.startsWith("(") || after.startsWith(" ");
}

/** CHANGELOG.md の「## <版>（日付）」の下の「- 」の行（3行まで）。無ければ止める（要約の無い札は作らない） */
export function changelogSummary(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const head = lines.findIndex((line) => isHeading(line, version));
  if (head < 0) throw new Error(`CHANGELOG.md に ${version} の見出しがありません`);
  const summary = [];
  for (const line of lines.slice(head + 1)) {
    if (/^##\s/.test(line)) break;
    const m = /^-\s+(.+)$/.exec(line.trim());
    if (m) summary.push(m[1].trim());
  }
  if (summary.length === 0) throw new Error(`CHANGELOG.md の ${version} に「- 」の行がありません`);
  return summary.slice(0, 3);
}

export function makeTicket({ version, date, summary, apk, minimumFrom = null }) {
  return {
    product: PRODUCT,
    version,
    date,
    summary,
    assets: [
      {
        platform: "android",
        name: apk.name,
        url: `https://github.com/${REPO}/releases/download/v${version}/${apk.name}`,
        sha256: apk.sha256,
        bytes: apk.bytes,
      },
    ],
    minimumFrom,
  };
}

/** 要約と、末尾に札の SHA-256（アプリはこの行と札を照らす） */
export function releaseNotes(summary, ticketSha) {
  return `${summary.map((line) => `- ${line}`).join("\n")}\n\nSHA-256：${ticketSha}\n`;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function main([version, apkPath, outDir]) {
  if (!version || !apkPath || !outDir) throw new Error("使い方：node scripts/updateTicket.mjs <版> <APK> <出す所>");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (pkg.version !== version) throw new Error(`package.json の版（${pkg.version}）とタグの版（${version}）が違います`);
  const summary = changelogSummary(readFileSync("CHANGELOG.md", "utf8"), version);
  mkdirSync(outDir, { recursive: true });
  const name = `${PRODUCT}-${version}.apk`;
  copyFileSync(apkPath, join(outDir, name));
  const apkBytes = readFileSync(join(outDir, name));
  const ticket = makeTicket({
    version,
    date: new Date().toISOString().slice(0, 10),
    summary,
    apk: { name, sha256: sha256(apkBytes), bytes: statSync(join(outDir, name)).size },
  });
  const text = `${JSON.stringify(ticket, null, 2)}\n`;
  writeFileSync(join(outDir, "update.json"), text);
  writeFileSync(join(outDir, "release-notes.md"), releaseNotes(summary, sha256(Buffer.from(text, "utf8"))));
  console.log(`update.json と release-notes.md を ${outDir} に書いた（${name}・${ticket.assets[0].bytes} バイト）`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
