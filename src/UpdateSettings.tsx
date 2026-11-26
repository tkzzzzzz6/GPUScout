import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { call, inTauri, openExternal } from "./api";
import { createUpdateController, updateBusy, type UpdateApi, type UpdateInfo } from "./updates";
import { Btn, ConfirmButton, FormRow, Group, Row, Sheet, Switch } from "./ui";
import packageInfo from "../package.json";

const releases = "https://github.com/tkzzzzzz6/GPUScout/releases";
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let previewAutoCheck = true;
const previewApi: UpdateApi = {
  info: async () => ({ version: packageInfo.version, configured: true, can_install: true, install_reason: null, auto_check: previewAutoCheck }),
  setAutoCheck: async (on) => { previewAutoCheck = on; },
  check: async () => {
    await wait(250);
    const [major, minor] = packageInfo.version.split(".").map(Number);
    return { version: `${major}.${minor + 1}.0`, body: "演示更新（假数据）\n改进更新提示与错误恢复。不会下载文件或修改系统。",
      download: async (progress) => {
        progress({ event: "Started", data: {} });
        for (let i = 0; i < 5; i++) { await wait(150); progress({ event: "Progress", data: { chunkLength: 1024 * 1024 } }); }
        progress({ event: "Finished" });
      }, install: async () => { await wait(250); }, close: async () => {} };
  },
  prepareInstall: async () => {}, cancelInstall: async () => {}, restart: async () => {},
};
const desktopApi: UpdateApi = {
  info: () => call<UpdateInfo>("updater_info"),
  check: async () => {
    const update = await check({ timeout: 15_000 });
    return update ? { version: update.version, body: update.body,
      download: (progress) => update.download(progress, { timeout: 10 * 60_000 }),
      install: () => update.install(), close: () => update.close() } : null;
  },
  setAutoCheck: (on) => call("set_update_auto_check", { on }),
  prepareInstall: () => call("prepare_update_install"),
  cancelInstall: () => call("cancel_update_install"),
  restart: () => relaunch(),
};
const Context = createContext<ReturnType<typeof createUpdateController> | null>(null);
const DialogContext = createContext<() => void>(() => {});

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => createUpdateController(inTauri ? desktopApi : previewApi));
  const [open, setOpen] = useState(false);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    void controller.initialize();
    // 浏览器演示只在用户点“检查更新”时运行假流程，不触发自动弹窗或网络请求。
    if (!inTauri) return;
    const first = setTimeout(() => { void controller.check(true); }, 20_000);
    const timer = setInterval(() => { void controller.check(true); }, 60_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [controller]);
  const busy = updateBusy(state);
  const downloading = state.phase === "downloading";
  const installing = state.phase === "installing";
  const percent = state.total ? Math.min(100, Math.floor(state.downloaded * 100 / state.total)) : null;
  return (
    <Context.Provider value={controller}>
      <DialogContext.Provider value={() => setOpen(true)}>
        {children}
        <Sheet open={open} onClose={() => { if (!busy) setOpen(false); }} title="软件更新"
          left={<button className="link-btn" disabled={busy} onClick={() => setOpen(false)}>稍后</button>}>
          <h2 className="title">{state.release ? `新版本 ${state.release.version}` : "检查软件更新"}</h2>
          {state.release && <pre className="update-notes">{state.release.notes}</pre>}
          {state.error && <p className="err-text" role="alert">{state.error}</p>}
          {state.info?.install_reason && <p className="group-foot">{state.info.install_reason}</p>}
          {downloading && <div role="status">
            <p>正在下载：{(state.downloaded / 1024 / 1024).toFixed(1)} MB{percent === null ? "" : ` · ${percent}%`}</p>
            <progress aria-label="更新下载进度" value={percent ?? undefined} max={100} />
          </div>}
          {installing && <p role="status">正在等待本轮监控完成并安装，请稍候…</p>}
          {state.phase === "installed"
            ? <><p role="status">{inTauri ? "安装完成，监控已暂停。重新启动后会恢复正常监控。" : "演示完成，没有下载或安装任何软件。"}</p>
              {inTauri && <Btn primary onClick={() => { void controller.restart(); }}>重新启动</Btn>}</>
            : <>
              {state.release && state.info?.can_install && <>
                <p className="group-foot">安装会暂停监控。Windows 安装程序会退出并重启软件；macOS 和 AppImage 安装后需要重新启动。请确认现在可以更新。</p>
                <ConfirmButton className="btn primary" icon="refresh" label="下载并安装" confirmLabel="确认安装并重启"
                  disabled={busy} onConfirm={() => controller.install()} />
              </>}
              {!busy && state.phase === "error" && <Btn icon="refresh" onClick={() => { void controller.check(); }}>重新检查</Btn>}
            </>}
          <div className="row" style={{ marginTop: 16 }}><Btn icon="external" disabled={installing} onClick={() => openExternal(releases)}>前往发布页面</Btn></div>
        </Sheet>
      </DialogContext.Provider>
    </Context.Provider>
  );
}

function useUpdates() {
  const controller = useContext(Context);
  if (!controller) throw Error("更新组件缺少 UpdateProvider");
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const show = useContext(DialogContext);
  return { controller, state, show };
}

export function UpdateBadge() {
  const { state, show } = useUpdates();
  if (!state.release) return null;
  return <button className="status-pill" onClick={show}>
    {state.phase === "installed" ? "更新待重启" : updateBusy(state) ? "正在更新…" : "有新版本"}
  </button>;
}

export function UpdateSettings() {
  const { controller, state, show } = useUpdates();
  const busy = updateBusy(state);
  const status = state.phase === "checking" ? "正在检查…" : state.phase === "latest" ? "已是最新版本"
    : state.phase === "installed" ? "更新待重启" : state.release ? `有新版本 ${state.release.version}` : "检查新版本";
  return (
    <div style={{ maxWidth: 640, marginBottom: 28 }}>
      <div className="group-label">软件更新{!inTauri && "（演示）"}</div>
      <Group>
        <Row icon="number" label="当前版本" value={state.info?.version ?? "正在读取…"} />
        <FormRow icon="refresh" label="自动检查更新">
          <Switch checked={state.info?.auto_check ?? true} disabled={!state.info || state.preferenceBusy || state.phase === "installing"}
            label="自动检查更新" onChange={(on) => { void controller.setAutoCheck(on); }} />
        </FormRow>
      </Group>
      <div className="group-foot">启动后和每 6 小时检查一次。有新版本时在顶栏提醒，点击确认后才下载并安装。</div>
      {state.info && !state.info.configured && <p className="group-foot">当前构建尚不支持应用内更新，请到发布页面下载最新版本。</p>}
      {state.error && <p className="err-text" role="alert">{state.error}</p>}
      <div className="row">
        {state.info ? <Btn icon="refresh" disabled={busy || !state.info.configured || state.phase === "installed"}
          onClick={() => { if (state.release) show(); else void controller.check(); }}>{status}</Btn>
          : <Btn icon="refresh" onClick={() => { void controller.initialize(); }}>重新读取更新设置</Btn>}
        {state.release && <Btn primary onClick={show}>查看更新</Btn>}
        <Btn icon="external" disabled={state.phase === "installing"} onClick={() => openExternal(releases)}>发布页面</Btn>
      </div>
    </div>
  );
}
