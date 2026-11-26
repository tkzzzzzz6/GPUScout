import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));

/** git pull 不会更新 node_modules，提前说明缺包原因，避免启动桌面窗口后才报导入失败。 */
export function dependencyProblems(root = project) {
  let manifest, lock;
  try {
    manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  } catch {
    return ["读不了 package.json 或 package-lock.json，请先恢复仓库中的依赖声明与锁文件。"];
  }
  const problems = [];
  for (const [name, range] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
    const expected = lock.packages?.[`node_modules/${name}`]?.version;
    const recorded = lock.packages?.[""]?.dependencies?.[name] ?? lock.packages?.[""]?.devDependencies?.[name];
    if (!expected || recorded !== range) {
      problems.push(`${name}：依赖声明与锁文件未同步；如果你修改了依赖，请先运行 npm install 更新锁文件。`);
      continue;
    }
    const directory = resolve(root, "node_modules", name);
    let installed;
    try { installed = JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8")); }
    catch { problems.push(`${name}：未安装或安装不完整。`); continue; }
    if (installed.version !== expected) {
      problems.push(`${name}：本地版本 ${installed.version ?? "未知"}，锁文件要求 ${expected}。`);
      continue;
    }
    // 只检查入口文件，不加载插件；Tauri 插件在 Node 中执行可能依赖桌面上下文。
    const entries = [installed.module, installed.main, installed.types].filter((entry) => typeof entry === "string" && entry);
    if (entries.some((entry) => !existsSync(resolve(directory, entry)))) {
      problems.push(`${name}：入口文件缺失，安装不完整。`);
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = dependencyProblems();
  if (problems.length) {
    console.error("前端依赖尚未同步。git pull 不会安装 npm 依赖。\n请先停止开发进程，在项目根目录运行 npm ci，再重试原命令。\n");
    console.error(problems.map((problem) => `- ${problem}`).join("\n"));
    process.exitCode = 1;
  }
}
