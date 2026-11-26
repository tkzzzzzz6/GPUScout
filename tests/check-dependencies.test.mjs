import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { dependencyProblems } from "../scripts/check-dependencies.mjs";

const updater = "@tauri-apps/plugin-updater", processPlugin = "@tauri-apps/plugin-process";
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "lookout dependency check "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dependencies = { [updater]: "^2.14.1", [processPlugin]: "^2.4.0" };
  writeFileSync(join(root, "package.json"), JSON.stringify({ name:"dependency-check-fixture", private:true, dependencies }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages: {
    "": { dependencies }, [`node_modules/${updater}`]: { version:"2.14.1" }, [`node_modules/${processPlugin}`]: { version:"2.4.0" },
  } }));
  return root;
}
function install(root, name, version) {
  const directory = join(root, "node_modules", name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name, version, module:"index.mjs" }));
  writeFileSync(join(directory, "index.mjs"), "throw Error('检查依赖时不能执行插件');");
}

test("依赖齐全时通过检查，不执行插件或修改文件", (t) => {
  const root = fixture(t); install(root, updater, "2.14.1"); install(root, processPlugin, "2.4.0");
  const before = readFileSync(join(root, "package-lock.json"));
  assert.deepEqual(dependencyProblems(root), []);
  assert.deepEqual(readFileSync(join(root, "package-lock.json")), before);
});

test("一次列出所有缺失插件，而不是修好一个后才报另一个", (t) => {
  const problems = dependencyProblems(fixture(t));
  assert.equal(problems.length, 2);
  assert(problems.some((problem) => problem.includes(updater)));
  assert(problems.some((problem) => problem.includes(processPlugin)));
});

test("检测旧版本和入口文件缺失", (t) => {
  const root = fixture(t); install(root, updater, "2.0.0"); install(root, processPlugin, "2.4.0");
  rmSync(join(root, "node_modules", processPlugin, "index.mjs"));
  assert(dependencyProblems(root).some((problem) => problem.includes("2.14.1")));
  assert(dependencyProblems(root).some((problem) => problem.includes("入口文件缺失")));
});

test("类型依赖无需可执行的 JavaScript 入口", (t) => {
  const root = fixture(t);
  const dependencies = { "@types/react":"^19.0.0" };
  writeFileSync(join(root, "package.json"), JSON.stringify({ devDependencies:dependencies }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages:{ "":{devDependencies:dependencies}, "node_modules/@types/react":{version:"19.1.0"} } }));
  const directory = join(root, "node_modules/@types/react"); mkdirSync(directory, { recursive:true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ version:"19.1.0", types:"index.d.ts" }));
  writeFileSync(join(directory, "index.d.ts"), "export {};");
  assert.deepEqual(dependencyProblems(root), []);
});

test("声明或锁文件无效时给出修复提示，不回显文件内容", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "package-lock.json"), "fake-private-value");
  const error = dependencyProblems(root).join("\n");
  assert(error.includes("恢复")); assert(!error.includes("fake-private-value"));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages:{ "":{} } }));
  assert(dependencyProblems(root).every((problem) => problem.includes("npm install")));
});

test("npm 开发钩子在缺包时退出，安装完整后才能启动", { skip: !process.env.npm_execpath && "通过 npm test 验证 npm 生命周期" }, (t) => {
  const root = fixture(t), scripts = join(root, "scripts"); mkdirSync(scripts);
  copyFileSync(fileURLToPath(new URL("../scripts/check-dependencies.mjs", import.meta.url)), join(scripts, "check-dependencies.mjs"));
  writeFileSync(join(scripts, "dev-marker.mjs"), "console.log('DEVELOPMENT_STARTED');");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  manifest.scripts = { predev:"node scripts/check-dependencies.mjs", dev:"node scripts/dev-marker.mjs" };
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
  const run = () => spawnSync(process.execPath, [process.env.npm_execpath, "--prefix", root, "run", "dev"], {
    cwd:root, encoding:"utf8", env:{ ...process.env, npm_config_cache:join(root, "npm-cache"), npm_config_update_notifier:"false" },
  });
  const missing = run(); assert.notEqual(missing.status, 0); assert.match(missing.stderr, /npm ci/);
  assert(!missing.stdout.includes("DEVELOPMENT_STARTED"));
  install(root, updater, "2.14.1"); install(root, processPlugin, "2.4.0");
  const ready = run(); assert.equal(ready.status, 0, ready.stderr); assert.match(ready.stdout, /DEVELOPMENT_STARTED/);
});
