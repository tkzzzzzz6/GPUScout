import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../src/updates.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const { createUpdateController, SIX_HOURS } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const info = { version: "0.1.1", configured: true, can_install: true, install_reason: null, auto_check: true };
const candidate = (extra = {}) => ({ version: "0.2.0", body: "release notes", close: async () => {}, download: async () => {}, install: async () => {}, ...extra });
const api = (extra = {}) => ({ info: async () => ({ ...info }), check: async () => candidate(),
  setAutoCheck: async () => {}, prepareInstall: async () => {}, cancelInstall: async () => {}, restart: async () => {}, ...extra });

test("启动延迟与六小时检查间隔生效，关闭自动检查后不发请求", async () => {
  let requests = 0;
  const c = createUpdateController(api({ check: async () => { requests++; return null; } }));
  await c.initialize(0);
  await c.check(true, 19_999); assert.equal(requests, 0);
  await c.check(true, 20_000); assert.equal(requests, 1);
  await c.check(true, 20_000 + SIX_HOURS - 1); assert.equal(requests, 1);
  await c.check(true, 20_000 + SIX_HOURS); assert.equal(requests, 2);
  await c.setAutoCheck(false);
  await c.check(true, 2 * SIX_HOURS + 20_000); assert.equal(requests, 2);
  await c.check(false, 2 * SIX_HOURS + 20_000); assert.equal(requests, 3);
});

test("离线失败退避，不会每次计时器触发都请求", async () => {
  let requests = 0;
  const c = createUpdateController(api({ check: async () => { requests++; throw Error("offline"); } }));
  await c.initialize(0);
  await c.check(true, 20_000);
  assert.match(c.getSnapshot().error, /offline/);
  await c.check(true, 21_000); assert.equal(requests, 1);
  await c.check(true, 80_000); assert.equal(requests, 2);
  await c.check(true, 140_000); assert.equal(requests, 2);
  await c.check(true, 200_000); assert.equal(requests, 3);
});

test("后台与手动检查合并，替换候选版本会释放旧资源", async () => {
  let complete, requests = 0, closed = 0;
  const c = createUpdateController(api({ check: async () => { requests++; return new Promise((resolve) => { complete = resolve; }); } }));
  await c.initialize(0);
  const pending = c.check(false, 20_000);
  await c.check(false, 20_000); assert.equal(requests, 1);
  complete(candidate({ close: async () => { closed++; } })); await pending;
  const again = c.check(false, 30_000);
  complete(null); await again;
  assert.equal(closed, 1);
  assert.equal(c.getSnapshot().phase, "latest");
  assert.equal(c.getSnapshot().release, null);
});

test("同版本、旧版本和预发布版本不进入安装流程", async () => {
  for (const version of ["0.1.1", "0.1.0", "0.2.0-beta.1", "wrong"]) {
    let closed = 0, installed = 0;
    const c = createUpdateController(api({ check: async () => candidate({ version, close: async () => { closed++; }, install: async () => { installed++; } }) }));
    await c.initialize(); await c.check(); await c.install();
    assert.equal(c.getSnapshot().phase, "error");
    assert.equal(closed, 1); assert.equal(installed, 0);
  }
});

test("未配置签名时不检查；不支持的安装方式仍可检查但不能安装", async () => {
  for (const configured of [true, false]) {
    let requests = 0, installed = 0;
    const c = createUpdateController(api({ info: async () => ({ ...info, configured, can_install: false }),
      check: async () => { requests++; return candidate({ install: async () => { installed++; } }); } }));
    await c.initialize(); await c.check(); await c.install();
    assert.equal(requests, configured ? 1 : 0); assert.equal(installed, 0);
  }
});

test("验签或下载失败时不能暂停监控或执行安装", async () => {
  let prepared = 0, installed = 0;
  const c = createUpdateController(api({ prepareInstall: async () => { prepared++; },
    check: async () => candidate({ download: async () => { throw Error("bad signature"); }, install: async () => { installed++; } }) }));
  await c.initialize(); await c.check(); await c.install();
  assert.match(c.getSnapshot().error, /bad signature/);
  assert.equal(prepared, 0); assert.equal(installed, 0);
});

test("无总长度时仍累计下载量；只安装一次且安装后由用户重启", async () => {
  let releaseDownload, installed = 0, restarts = 0;
  const c = createUpdateController(api({ restart: async () => { restarts++; },
    check: async () => candidate({ download: async (event) => {
      event({ event: "Started", data: {} });
      event({ event: "Progress", data: { chunkLength: 123 } });
      await new Promise((resolve) => { releaseDownload = resolve; });
    }, install: async () => { installed++; } }) }));
  await c.initialize(); await c.check();
  const pending = c.install();
  await c.install();
  assert.equal(c.getSnapshot().total, null); assert.equal(c.getSnapshot().downloaded, 123);
  releaseDownload(); await pending;
  assert.equal(installed, 1); assert.equal(restarts, 0);
  assert.equal(c.getSnapshot().phase, "installed");
  await c.install(); assert.equal(installed, 1);
  await c.restart(); assert.equal(restarts, 1);
});

test("安装失败恢复监控，重试会重新下载验签", async () => {
  let restores = 0, downloads = 0, installs = 0;
  const c = createUpdateController(api({ cancelInstall: async () => { restores++; },
    check: async () => candidate({ download: async () => { downloads++; }, install: async () => { if (!installs++) throw Error("disk full"); } }) }));
  await c.initialize(); await c.check(); await c.install();
  assert.match(c.getSnapshot().error, /disk full/); assert.equal(restores, 1);
  await c.install(); assert.equal(downloads, 2); assert.equal(c.getSnapshot().phase, "installed");
});

test("自动检查偏好保存失败保留原设置，成功后重开从存储读取", async () => {
  let enabled = true, fail = true;
  const native = api({ info: async () => ({ ...info, auto_check: enabled }), setAutoCheck: async (on) => { if (fail) throw Error("read only"); enabled = on; } });
  const c = createUpdateController(native);
  await c.initialize(); await c.setAutoCheck(false);
  assert.equal(c.getSnapshot().info.auto_check, true); assert.match(c.getSnapshot().error, /read only/);
  fail = false; await c.setAutoCheck(false);
  const reopened = createUpdateController(native); await reopened.initialize();
  assert.equal(reopened.getSnapshot().info.auto_check, false);
});
