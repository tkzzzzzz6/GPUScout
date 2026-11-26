import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const targets = {
  "windows-x86_64": /_x64-setup\.exe$/,
  "darwin-aarch64": /_aarch64\.app\.tar\.gz$/,
  "darwin-x86_64": /_x64\.app\.tar\.gz$/,
  "linux-x86_64": /_amd64\.AppImage$/,
};
const installers = [/_x64-setup\.exe$/, /_x64_en-US\.msi$/, /_aarch64\.dmg$/, /_x64\.dmg$/, /_amd64\.deb$/, /\.x86_64\.rpm$/, /_amd64\.AppImage$/];

function releaseVersion(tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) throw Error("tag 必须是 vX.Y.Z");
  return tag.slice(1);
}

function validateArtifactName(name, version) {
  const asset = name.replace(/\.sig$/, "");
  const expected = [
    `GPUScout_${version}_x64-setup.exe`, `GPUScout_${version}_x64_en-US.msi`,
    `GPUScout_${version}_aarch64.dmg`, `GPUScout_${version}_x64.dmg`,
    `GPUScout_${version}_amd64.deb`, `GPUScout_${version}_amd64.AppImage`,
    `GPUScout_${version}_aarch64.app.tar.gz`, `GPUScout_${version}_x64.app.tar.gz`,
  ];
  const rpm = new RegExp(`^GPUScout-${version.replaceAll(".", "\\.")}(?:-\\d+)?\\.x86_64\\.rpm$`);
  if (!expected.includes(asset) && !rpm.test(asset)) {
    throw Error(`产物名称或版本不符：${name}，应为 GPUScout ${version} 的安装/更新包`);
  }
}

export function decodeSigningText(value, label) {
  const text = value?.trim();
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw Error(`${label} 缺失或不是 Tauri 的 base64 格式`);
  const bytes = Buffer.from(text, "base64");
  if (bytes.toString("base64").replace(/=+$/, "") !== text.replace(/=+$/, "")) throw Error(`${label} 编码无效`);
  return bytes.toString("utf8");
}

export function validatePublicKey(value) {
  const decoded = decodeSigningText(value, "TAURI_UPDATER_PUBLIC_KEY");
  const lines = decoded.trim().split(/\r?\n/);
  const packet = Buffer.from(lines[1] ?? "", "base64");
  if (!lines[0]?.startsWith("untrusted comment:") || packet.length !== 42 || packet.subarray(0, 2).toString() !== "Ed") {
    throw Error("TAURI_UPDATER_PUBLIC_KEY 不是 Tauri signer 生成的公钥文件内容");
  }
  return value.trim();
}

function releaseMode(mode) {
  if (!["installers", "signed"].includes(mode)) throw Error("发布模式必须是 installers 或 signed");
  return mode;
}

export function updaterConfig(env, mode = "installers") {
  releaseMode(mode);
  const repository = env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw Error("GITHUB_REPOSITORY 无效");
  if (mode === "signed") {
    for (const name of ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "TAURI_UPDATER_PUBLIC_KEY"]) {
      if (!env[name]?.trim()) throw Error(`请先在仓库 Actions 设置中配置 ${name}`);
    }
  }
  return { bundle: { createUpdaterArtifacts: mode === "signed" }, plugins: { updater: {
    pubkey: mode === "signed" ? validatePublicKey(env.TAURI_UPDATER_PUBLIC_KEY) : "",
    requireSignedVersion: true,
    endpoints: [`https://github.com/${repository}/releases/latest/download/latest.json`],
  } } };
}

function releaseFiles(directory, tag) {
  const version = releaseVersion(tag);
  const files = readdirSync(directory).filter((name) => name !== "checksums.txt");
  for (const name of files) {
    if (name !== "latest.json") validateArtifactName(name, version);
    if (!statSync(join(directory, name)).isFile() || statSync(join(directory, name)).size === 0) throw Error(`发布文件为空或不是普通文件：${name}`);
  }
  return files;
}

function validateInstallers(directory, files) {
  for (const pattern of installers) {
    const matches = files.filter((file) => pattern.test(file));
    if (matches.length !== 1) throw Error(`安装包缺失或重复：${pattern}`);
    if (!statSync(join(directory, matches[0])).isFile() || statSync(join(directory, matches[0])).size === 0) throw Error(`安装包为空：${matches[0]}`);
  }
}

/** GNU sha256sum 格式，覆盖所有其他发布文件；自身不参与哈希，避免循环依赖。 */
export function createChecksums(directory, tag, mode = "installers") {
  releaseMode(mode);
  const files = releaseFiles(directory, tag);
  validateInstallers(directory, files);
  if (mode === "installers" && files.some((name) => !installers.some((pattern) => pattern.test(name)))) {
    throw Error("普通安装包模式不接受更新清单、签名或自动更新压缩包");
  }
  if (mode === "signed") {
    if (!files.includes("latest.json")) throw Error("签名更新模式缺少 latest.json");
    const manifest = JSON.parse(readFileSync(join(directory, "latest.json"), "utf8"));
    if (manifest.version !== releaseVersion(tag) || Object.keys(manifest.platforms ?? {}).sort().join() !== Object.keys(targets).sort().join()) throw Error("更新清单版本或平台不符");
    for (const pattern of Object.values(targets)) {
      const matches = files.filter((name) => pattern.test(name));
      if (matches.length !== 1 || !files.includes(`${matches[0]}.sig`)) throw Error("签名更新模式缺少更新文件或签名");
    }
  }
  const contents = files.sort().map((name) => `${createHash("sha256").update(readFileSync(join(directory, name))).digest("hex")}  ${name}\n`).join("");
  writeFileSync(join(directory, "checksums.txt"), contents);
  return contents;
}

/** 下载时保留各平台 artifact 目录，先解决 macOS 同名文件，再统一清理空格。 */
export function collectArtifacts(downloadDir, outputDir, tag) {
  const version = releaseVersion(tag);
  const planned = new Map();
  const visit = (directory, bundle) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { visit(path, bundle); continue; }
      if (!entry.isFile()) throw Error(`不接受非普通文件：${entry.name}`);
      let name = entry.name.replaceAll(" ", ".");
      if (/\.app\.tar\.gz(?:\.sig)?$/.test(name)) {
        const arch = { "bundle-macos-aarch64": "aarch64", "bundle-macos-x64": "x64" }[bundle];
        if (!arch) throw Error(`macOS 更新包的平台目录不明确：${bundle}`);
        if (!/^GPUScout\.app\.tar\.gz(?:\.sig)?$/.test(name)) throw Error(`macOS 更新包名称不符：${name}`);
        name = name.replace(".app.tar.gz", `_${version}_${arch}.app.tar.gz`);
      }
      if (planned.has(name)) throw Error(`更新产物重名：${name}`);
      planned.set(name, path);
    }
  };
  for (const bundle of readdirSync(downloadDir, { withFileTypes: true })) {
    if (!bundle.isDirectory() || !/^bundle-(windows-x64|macos-aarch64|macos-x64|linux-x64)$/.test(bundle.name)) {
      throw Error(`未知构建目录：${bundle.name}`);
    }
    visit(join(downloadDir, bundle.name), bundle.name);
  }
  if (readdirSync(outputDir).length) throw Error("输出目录必须为空，避免使用旧构建产物");
  for (const name of planned.keys()) validateArtifactName(name, version);
  for (const [name, source] of planned) renameSync(source, join(outputDir, name));
}

export function verifySignature(file, signature, publicKey, version) {
  const temp = mkdtempSync(join(tmpdir(), "lookout-verify-"));
  try {
    const decoded = decodeSigningText(signature, `${basename(file)}.sig`);
    const trusted = decoded.split(/\r?\n/).find((line) => line.startsWith("trusted comment:"));
    if (!trusted?.split("\t").includes(`version:${version}`)) throw Error(`${basename(file)} 的签名未绑定目标版本 ${version}`);
    writeFileSync(join(temp, "public.key"), decodeSigningText(validatePublicKey(publicKey), "公钥"));
    writeFileSync(join(temp, "artifact.minisig"), decoded);
    try {
      execFileSync("minisign", ["-Vm", resolve(file), "-p", join(temp, "public.key"), "-x", join(temp, "artifact.minisig")], { stdio: "pipe" });
    } catch {
      throw Error(`${basename(file)} 验签失败；检查更新公钥、产物和签名，及 minisign 是否已安装`);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

export function createManifest(directory, tag, repository, publicKey, notes, verify = verifySignature) {
  const version = releaseVersion(tag);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw Error("仓库名称无效");
  validatePublicKey(publicKey);
  const files = releaseFiles(directory, tag).filter((name) => name !== "latest.json");
  validateInstallers(directory, files);
  const platforms = {};
  for (const [target, pattern] of Object.entries(targets)) {
    const matches = files.filter((file) => pattern.test(file));
    if (matches.length !== 1) throw Error(`更新包缺失或重复：${target}`);
    const name = matches[0], file = join(directory, name);
    if (!statSync(file).isFile() || statSync(file).size === 0) throw Error(`更新包为空：${name}`);
    const signature = readFileSync(`${file}.sig`, "utf8").trim();
    verify(file, signature, publicKey, tag.slice(1));
    platforms[target] = { url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`, signature };
  }
  return { version: tag.slice(1), notes, pub_date: new Date().toISOString(), platforms };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === "config" && (args.length === 1 || args.length === 2)) {
      writeFileSync(args[0], JSON.stringify(updaterConfig(process.env, args[1] ?? "installers"), null, 2) + "\n");
    } else if (command === "collect" && args.length === 3) {
      collectArtifacts(...args);
    } else if (command === "checksums" && args.length === 3) {
      createChecksums(...args);
    } else if (command === "manifest" && args.length === 4) {
      const [directory, tag, repository, notesFile] = args;
      const manifest = createManifest(directory, tag, repository, process.env.TAURI_UPDATER_PUBLIC_KEY, readFileSync(notesFile, "utf8"));
      writeFileSync(join(directory, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
    } else throw Error("用法：updater-artifacts.mjs config <输出配置> [installers|signed] | checksums <产物目录> <tag> <installers|signed> | collect <下载目录> <空输出目录> <tag> | manifest <产物目录> <tag> <owner/repo> <发布说明>");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
