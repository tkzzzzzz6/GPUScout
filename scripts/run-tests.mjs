import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// 显式列出文件，避免 Windows 上旧版 Node 把通配符当成文件名。
const directory = new URL("../tests/", import.meta.url);
const files = readdirSync(directory).filter((name) => name.endsWith(".test.mjs")).sort()
  .map((name) => fileURLToPath(new URL(name, directory)));
if (!files.length) throw Error("没有找到前端/脚本测试，不能将零测试视为通过");
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
