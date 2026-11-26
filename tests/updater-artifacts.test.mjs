import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectArtifacts, createManifest, updaterConfig, validatePublicKey, verifySignature } from "../scripts/updater-artifacts.mjs";

const pub = Buffer.from(`untrusted comment: test public key\n${Buffer.concat([Buffer.from("Ed"), Buffer.alloc(40, 1)]).toString("base64")}\n`).toString("base64");
const names = ["GPUScout_0.2.0_x64-setup.exe", "GPUScout_0.2.0_x64_en-US.msi", "GPUScout_0.2.0_aarch64.dmg", "GPUScout_0.2.0_x64.dmg", "GPUScout_0.2.0_amd64.deb", "GPUScout-0.2.0.x86_64.rpm", "GPUScout_0.2.0_amd64.AppImage", "GPUScout_aarch64.app.tar.gz", "GPUScout_x64.app.tar.gz"];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "lookout-manifest-test-"));
  for (const name of names) { writeFileSync(join(dir, name), "test fixture"); writeFileSync(join(dir, `${name}.sig`), "signature fixture"); }
  return dir;
}
const withoutCrypto = () => {};

test("签名配置缺失时明确指出变量名，不输出秘密", () => {
  assert.throws(() => updaterConfig({}), /TAURI_SIGNING_PRIVATE_KEY/);
  assert.throws(() => validatePublicKey("not-a-key"), /base64/);
  const config = updaterConfig({ GITHUB_REPOSITORY: "owner/repo", TAURI_SIGNING_PRIVATE_KEY: "not-printed", TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "not-printed", TAURI_UPDATER_PUBLIC_KEY: pub });
  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.equal(config.plugins.updater.pubkey, pub);
  assert.ok(!JSON.stringify(config).includes("not-printed"));
});

test("清单使用四个目标平台、最终文件名和签名内容", () => {
  const dir = fixture();
  try {
    const manifest = createManifest(dir, "v0.2.0", "owner/repo", pub, "说明", withoutCrypto);
    assert.equal(manifest.version, "0.2.0");
    assert.equal(Object.keys(manifest.platforms).length, 4);
    assert.equal(manifest.platforms["darwin-aarch64"].signature, "signature fixture");
    assert.match(manifest.platforms["windows-x86_64"].url, /v0.2.0\/GPUScout_0.2.0_x64-setup.exe$/);
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
      writeFileSync(join(bundle, "GPUScout Preview.app.tar.gz"), arch);
      writeFileSync(join(bundle, "GPUScout Preview.app.tar.gz.sig"), `${arch}-sig`);
    }
    const out = join(temp, "out"); mkdirSync(out);
    collectArtifacts(join(temp, "download"), out);
    assert.equal(readFileSync(join(out, "GPUScout.Preview_aarch64.app.tar.gz"), "utf8"), "aarch64");
    assert.equal(readFileSync(join(out, "GPUScout.Preview_x64.app.tar.gz.sig"), "utf8"), "x64-sig");
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
      assert.throws(() => collectArtifacts(join(temp, "download"), out), /重名|旧构建/);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }
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
