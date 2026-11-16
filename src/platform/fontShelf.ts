import { Directory, Filesystem } from "@capacitor/filesystem";
import { base64ToBytes, bytesToBase64 } from "./capacitorFileStore";
import type { FontShelf } from "./fontDownload";

/**
 * 取り寄せた書体の置き場：アプリ専用の領域（`Directory.Data`）の `fonts/`。作品（`works/`）の外なので、
 * 作品一覧にも同期にも出ない（引継ぎ書 68章）。中身は使う前に毎回照らすので、書く途中で止められても使わない
 */
export class DeviceFontShelf implements FontShelf {
  constructor(private readonly folder = "fonts") {}

  async read(name: string): Promise<Uint8Array | undefined> {
    try {
      const { data } = await Filesystem.readFile({ path: `${this.folder}/${name}`, directory: Directory.Data });
      return typeof data === "string" ? base64ToBytes(data) : new Uint8Array(await data.arrayBuffer());
    } catch {
      return undefined;
    }
  }

  async write(name: string, bytes: Uint8Array): Promise<void> {
    await Filesystem.mkdir({ path: this.folder, directory: Directory.Data, recursive: true }).catch(() => undefined);
    await Filesystem.writeFile({ path: `${this.folder}/${name}`, directory: Directory.Data, data: bytesToBase64(bytes), recursive: true });
  }

  async remove(name: string): Promise<void> {
    await Filesystem.deleteFile({ path: `${this.folder}/${name}`, directory: Directory.Data });
  }
}
