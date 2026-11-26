import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectArtifacts, createChecksums, createManifest, updaterConfig, validatePublicKey, verifySignature } from "../scripts/updater-artifacts.mjs";

const pub = Buffer.from(`untrusted comment: test public key\n${Buffer.concat([Buffer.from("Ed"), Buffer.alloc(40, 1)]).toString("base64")}\n`).toString("base64");
const names = ["GPUScout_0.2.0_x64-setup.exe", "GPUScout_0.2.0_x64_en-US.msi", "GPUScout_0.2.0_aarch64.dmg", "GPUScout_0.2.0_x64.dmg", "GPUScout_0.2.0_amd64.deb", "GPUScout-0.2.0-1.x86_64.rpm", "GPUScout_0.2.0_amd64.AppImage", "GPUScout_0.2.0_aarch64.app.tar.gz", "GPUScout_0.2.0_x64.app.tar.gz"];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "lookout-manifest-test-"));
  for (const name of names) { writeFileSync(join(dir, name), "test fixture"); writeFileSync(join(dir, `${name}.sig`), "signature fixture"); }
  return dir;
}
const withoutCrypto = () => {};

test("签名配置缺失时明确指出变量名，不输出秘密", () => {
  assert.throws(() => updaterConfig({ GITHUB_REPOSITORY: "owner/repo" }, "signed"), /TAURI_SIGNING_PRIVATE_KEY/);
  assert.throws(() => validatePublicKey("not-a-key"), /base64/);
  const config = updaterConfig({ GITHUB_REPOSITORY: "tkzzzzzz6/GPUScout", TAURI_SIGNING_PRIVATE_KEY: "not-printed", TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "not-printed", TAURI_UPDATER_PUBLIC_KEY: pub }, "signed");
  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.equal(config.plugins.updater.pubkey, pub);
  assert.deepEqual(config.plugins.updater.endpoints, ["https://github.com/tkzzzzzz6/GPUScout/releases/latest/download/latest.json"]);
  assert.ok(!JSON.stringify(config).includes("not-printed"));
});

test("普通安装包不依赖密钥，忽略遗留错误密钥并清空更新公钥", () => {
  for (const [credentials, mode] of [[{}, undefined], [{ TAURI_SIGNING_PRIVATE_KEY: "bad-private", TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "bad-password", TAURI_UPDATER_PUBLIC_KEY: "bad-public" }, "installers"]]) {
    const config = updaterConfig({ GITHUB_REPOSITORY: "owner/repo", ...credentials }, mode);
    assert.equal(config.bundle.createUpdaterArtifacts, false);
    assert.equal(config.plugins.updater.pubkey, "");
    assert.equal(config.plugins.updater.requireSignedVersion, true);
    assert.ok(!JSON.stringify(config).includes("bad-"));
  }
  assert.throws(() => updaterConfig({ GITHUB_REPOSITORY: "owner/repo" }, "other"), /发布模式/);
});

function installerFixture() {
  const dir = mkdtempSync(join(tmpdir(), "lookout-checksums-test-"));
  for (const name of names.slice(0, 7)) writeFileSync(join(dir, name), "abc");
  return dir;
}

test("checksums.txt 使用标准 SHA-256 双空格格式，排除自身并检测篡改", () => {
  const dir = installerFixture();
  try {
    const hash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"; // SHA-256 标准向量 abc
    const expected = names.slice(0, 7).sort().map((name) => `${hash}  ${name}\n`).join("");
    assert.equal(createChecksums(dir, "v0.2.0", "installers"), expected);
    assert.equal(readFileSync(join(dir, "checksums.txt"), "utf8"), expected);
    assert.equal(createChecksums(dir, "v0.2.0", "installers"), expected, "重跑不能把旧 checksums.txt 放进自身");
    const verified = spawnSync("sha256sum", ["--check", "checksums.txt"], { cwd: dir });
    if (!verified.error) {
      assert.equal(verified.status, 0);
      writeFileSync(join(dir, names[0]), "tampered");
      assert.equal(spawnSync("sha256sum", ["--check", "checksums.txt"], { cwd: dir }).status, 1);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("普通包缺平台、为空或混入更新产物时拒绝校验清单", () => {
  for (const problem of ["missing", "empty", "manifest", "signature", "archive"]) {
    const dir = installerFixture();
    try {
      if (problem === "missing") rmSync(join(dir, names[0]));
      if (problem === "empty") writeFileSync(join(dir, names[0]), "");
      if (problem === "manifest") writeFileSync(join(dir, "latest.json"), "{}");
      if (problem === "signature") writeFileSync(join(dir, `${names[0]}.sig`), "signature");
      if (problem === "archive") writeFileSync(join(dir, names[7]), "archive");
      assert.throws(() => createChecksums(dir, "v0.2.0", "installers"));
      assert.equal(existsSync(join(dir, "checksums.txt")), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("签名模式校验清单覆盖更新元数据与签名，缺任一关键文件就拒绝", () => {
  const dir = fixture();
  try {
    assert.throws(() => createChecksums(dir, "v0.2.0", "signed"), /latest.json/);
    const manifest = createManifest(dir, "v0.2.0", "owner/repo", pub, "", withoutCrypto);
    writeFileSync(join(dir, "latest.json"), JSON.stringify(manifest));
    const checksum = createChecksums(dir, "v0.2.0", "signed");
    assert.equal(checksum.trim().split("\n").length, names.length * 2 + 1);
    assert.match(checksum, /  latest\.json\n/);
    assert.match(checksum, /  GPUScout_0\.2\.0_aarch64\.app\.tar\.gz\.sig\n/);
    rmSync(join(dir, `${names[0]}.sig`));
    assert.throws(() => createChecksums(dir, "v0.2.0", "signed"), /缺少更新文件或签名/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("清单使用四个目标平台、最终文件名和签名内容", () => {
  const dir = fixture();
  try {
    const manifest = createManifest(dir, "v0.2.0", "tkzzzzzz6/GPUScout", pub, "说明", withoutCrypto);
    assert.equal(manifest.version, "0.2.0");
    assert.equal(Object.keys(manifest.platforms).length, 4);
    assert.equal(manifest.platforms["darwin-aarch64"].signature, "signature fixture");
    assert.equal(manifest.platforms["windows-x86_64"].url, "https://github.com/tkzzzzzz6/GPUScout/releases/download/v0.2.0/GPUScout_0.2.0_x64-setup.exe");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("缺安装包、缺签名或重复平台时拒绝清单", () => {
  for (const problem of ["installer", "signature", "duplicate", "empty"]) {
    const dir = fixture();
    try {
      if (problem === "installer") rmSync(join(dir, names[4]));
      if (problem === "signature") rmSync(join(dir, `${names[0]}.sig`));
      if (problem === "duplicate") writeFileSync(join(dir, "Another_x64-setup.exe"), "other");
      if (problem === "empty") writeFileSync(join(dir, names[0]), "");
      assert.throws(() => createManifest(dir, "v0.2.0", "owner/repo", pub, "", withoutCrypto));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("两个 macOS 架构的同名更新包和签名不会覆盖", () => {
  const temp = mkdtempSync(join(tmpdir(), "lookout-collect-test-"));
  try {
    for (const arch of ["aarch64", "x64"]) {
      const bundle = join(temp, "download", `bundle-macos-${arch}`, "macos"); mkdirSync(bundle, { recursive: true });
      writeFileSync(join(bundle, "GPUScout.app.tar.gz"), arch);
      writeFileSync(join(bundle, "GPUScout.app.tar.gz.sig"), `${arch}-sig`);
    }
    const out = join(temp, "out"); mkdirSync(out);
    collectArtifacts(join(temp, "download"), out, "v0.2.0");
    assert.equal(readFileSync(join(out, "GPUScout_0.2.0_aarch64.app.tar.gz"), "utf8"), "aarch64");
    assert.equal(readFileSync(join(out, "GPUScout_0.2.0_x64.app.tar.gz.sig"), "utf8"), "x64-sig");
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("规范化后重名或输出含旧产物时拒绝收集", () => {
  for (const stale of [false, true]) {
    const temp = mkdtempSync(join(tmpdir(), "lookout-collision-test-"));
    try {
      const source = join(temp, "download", "bundle-windows-x64"); mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "A B.exe"), "one");
      const out = join(temp, "out"); mkdirSync(out);
      if (stale) writeFileSync(join(out, "old.exe"), "old");
      else writeFileSync(join(source, "A.B.exe"), "two");
      assert.throws(() => collectArtifacts(join(temp, "download"), out, "v0.2.0"), /重名|旧构建/);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }
});

test("旧版本或旧品牌文件在移动及生成清单前被拒绝", () => {
  for (const bad of ["GPUScout_0.1.1_x64-setup.exe", "AutoDL.Lookout_0.2.0_x64-setup.exe", "GPUScout-0.1.1-1.x86_64.rpm", "GPUScout_0.2.0.1_x64-setup.exe", "GPUScout_0.2.0_arm64.deb"]) {
    const temp = mkdtempSync(join(tmpdir(), "lookout-release-name-test-"));
    const dir = fixture();
    try {
      const source = join(temp, "download", "bundle-windows-x64"); mkdirSync(source, { recursive: true });
      writeFileSync(join(source, bad), "stale fixture");
      const out = join(temp, "out"); mkdirSync(out);
      assert.throws(() => collectArtifacts(join(temp, "download"), out, "v0.2.0"), /名称或版本不符/);
      assert.ok(existsSync(join(source, bad)), "拒绝时不应先移动部分文件");
      writeFileSync(join(dir, bad), "stale fixture");
      assert.throws(() => createManifest(dir, "v0.2.0", "owner/repo", pub, "", withoutCrypto), /名称或版本不符/);
    } finally { rmSync(temp, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); }
  }
});

test("macOS 清单 URL 同时包含产品、版本和架构", () => {
  const dir = fixture();
  try {
    const manifest = createManifest(dir, "v0.2.0", "owner/repo", pub, "", withoutCrypto);
    assert.match(manifest.platforms["darwin-aarch64"].url, /GPUScout_0\.2\.0_aarch64\.app\.tar\.gz$/);
    assert.match(manifest.platforms["darwin-x86_64"].url, /GPUScout_0\.2\.0_x64\.app\.tar\.gz$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("真实 Tauri 签名可验证，篡改产物、公钥、版本和签名都被拒绝", { skip: spawnSync("minisign", ["-v"]).status !== 0 }, () => {
  const temp = mkdtempSync(join(tmpdir(), "lookout-signature-test-"));
  const tauri = fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url));
  try {
    const key = join(temp, "test.key"), asset = join(temp, "test.exe");
    // 仅用于临时测试；测试私钥不输出、不提交，并在 finally 中删除。
    execFileSync(process.execPath, [tauri, "signer", "generate", "-p", "test-only", "--ci", "-w", key], { stdio: "pipe" });
    writeFileSync(asset, "original test artifact");
    execFileSync(process.execPath, [tauri, "signer", "sign", "-f", key, "-p", "test-only", "--app-version", "0.2.0", asset], { stdio: "pipe" });
    const publicKey = readFileSync(`${key}.pub`, "utf8"), signature = readFileSync(`${asset}.sig`, "utf8");
    verifySignature(asset, signature, publicKey, "0.2.0");
    assert.throws(() => verifySignature(asset, signature, publicKey, "0.3.0"), /目标版本/);
    assert.throws(() => verifySignature(asset, signature, pub, "0.2.0"), /验签失败/);
    assert.throws(() => verifySignature(asset, signature.slice(4), publicKey, "0.2.0"));
    writeFileSync(asset, "tampered artifact");
    assert.throws(() => verifySignature(asset, signature, publicKey, "0.2.0"), /验签失败/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
