import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// 只加载纯状态逻辑，不依赖桌面插件或 DOM，也不提高项目的 Node 最低版本。
const source = ts.transpileModule(readFileSync(new URL("../src/autostart.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const { createAutostartController } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("读取失败显示未知，重试恢复系统真实状态", async () => {
  let fails = true;
  const c = createAutostartController({ isEnabled: async () => { if (fails) throw Error("permission"); return true; } });
  await c.refresh();
  assert.equal(c.getSnapshot().enabled, null);
  assert.match(c.getSnapshot().error, /permission/);
  fails = false;
  await c.refresh();
  assert.deepEqual(c.getSnapshot(), { enabled: true, busy: false, error: null });
});

test("启停后回读，重新进入设置仍反映系统状态", async () => {
  let enabled = false;
  const api = { isEnabled: async () => enabled, enable: async () => { enabled = true; }, disable: async () => { enabled = false; } };
  const c = createAutostartController(api);
  await c.refresh();
  await c.setEnabled(true);
  assert.equal(c.getSnapshot().enabled, true);
  const reopened = createAutostartController(api);
  await reopened.refresh();
  assert.equal(reopened.getSnapshot().enabled, true);
  await c.setEnabled(false);
  assert.equal(c.getSnapshot().enabled, false);
});

test("启用与禁用失败均保留系统回读结果并给出原因", async () => {
  for (const enabled of [false, true]) {
    const c = createAutostartController({ isEnabled: async () => enabled,
      enable: async () => { throw Error("denied"); }, disable: async () => { throw Error("denied"); } });
    await c.refresh();
    await c.setEnabled(!enabled);
    assert.equal(c.getSnapshot().enabled, enabled);
    assert.match(c.getSnapshot().error, /denied/);
  }
});

test("系统拒绝改变状态时不假装操作成功", async () => {
  const c = createAutostartController({ isEnabled: async () => false, enable: async () => {} });
  await c.refresh();
  await c.setEnabled(true);
  assert.equal(c.getSnapshot().enabled, false);
  assert.match(c.getSnapshot().error, /系统状态未改变/);
});

test("操作成功但回读失败时显示未知，错误不会逃出 Promise", async () => {
  let reads = 0;
  const c = createAutostartController({ isEnabled: async () => { if (reads++) throw Error("read failed"); return false; }, enable: async () => {} });
  await c.refresh();
  await c.setEnabled(true);
  assert.equal(c.getSnapshot().enabled, null);
  assert.match(c.getSnapshot().error, /read failed/);
  assert.equal(c.getSnapshot().busy, false);
});

test("同一轮连续点击不会并发修改系统启动项", async () => {
  let finish;
  let calls = 0;
  let enabled = false;
  const c = createAutostartController({ isEnabled: async () => enabled,
    enable: async () => { calls++; await new Promise((resolve) => { finish = resolve; }); enabled = true; },
    disable: async () => { calls++; enabled = false; } });
  await c.refresh();
  const pending = c.setEnabled(true);
  await c.setEnabled(false);
  assert.equal(calls, 1);
  assert.equal(c.getSnapshot().busy, true);
  finish();
  await pending;
  assert.equal(c.getSnapshot().enabled, true);
});
