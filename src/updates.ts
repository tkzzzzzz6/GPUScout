export interface UpdateInfo {
  version: string;
  configured: boolean;
  can_install: boolean;
  install_reason: string | null;
  auto_check: boolean;
}
export type UpdateEvent = { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } } | { event: "Finished" };
export interface UpdateCandidate {
  version: string;
  body?: string;
  download(progress: (event: UpdateEvent) => void): Promise<void>;
  install(): Promise<void>;
  close(): Promise<void>;
}
export interface UpdateApi {
  info(): Promise<UpdateInfo>;
  check(): Promise<UpdateCandidate | null>;
  setAutoCheck(on: boolean): Promise<void>;
  prepareInstall(): Promise<void>;
  cancelInstall(): Promise<void>;
  restart(): Promise<void>;
}
export interface UpdateState {
  info: UpdateInfo | null;
  phase: "idle" | "checking" | "latest" | "available" | "downloading" | "installing" | "installed" | "error";
  release: { version: string; notes: string } | null;
  downloaded: number;
  total: number | null;
  error: string | null;
  preferenceBusy: boolean;
}

export const SIX_HOURS = 6 * 60 * 60 * 1000;
export const updateBusy = (state: UpdateState) => ["checking", "downloading", "installing"].includes(state.phase);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const newer = (version: string, current: string) => {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^\d+\.\d+\.\d+$/.test(current)) return false;
  const a = version.split(".").map(Number), b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
};

/** 全应用共享一个任务，后台检查、手动检查和安装不会互相覆盖。 */
export function createUpdateController(api: UpdateApi) {
  let state: UpdateState = { info: null, phase: "idle", release: null, downloaded: 0, total: null, error: null, preferenceBusy: false };
  let candidate: UpdateCandidate | null = null;
  let initializing = false;
  let nextAutomatic = 0;
  let failures = 0;
  const listeners = new Set<() => void>();
  const patch = (next: Partial<UpdateState>) => { state = { ...state, ...next }; listeners.forEach((f) => f()); };
  const close = async (update: UpdateCandidate | null) => { try { await update?.close(); } catch { /* 不让已失效资源影响下一次检查。 */ } };
  const controller = {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async initialize(now = Date.now()) {
      if (initializing || state.info) return;
      initializing = true;
      try { patch({ info: await api.info(), error: null, phase: "idle" }); nextAutomatic = now + 20_000; }
      catch (error) { patch({ phase: "error", error: `无法读取更新设置：${message(error)}` }); }
      finally { initializing = false; }
    },
    async setAutoCheck(on: boolean) {
      if (!state.info || state.preferenceBusy) return;
      patch({ preferenceBusy: true, error: null });
      try { await api.setAutoCheck(on); patch({ info: { ...state.info!, auto_check: on } }); }
      catch (error) { patch({ error: `无法保存更新设置：${message(error)}` }); }
      finally { patch({ preferenceBusy: false }); }
    },
    async check(automatic = false, now = Date.now()) {
      if (!state.info?.configured || updateBusy(state) || state.phase === "installed") return;
      if (automatic && (!state.info.auto_check || now < nextAutomatic)) return;
      patch({ phase: "checking", error: null });
      try {
        const found = await api.check();
        if (found && !newer(found.version, state.info.version)) {
          await close(found);
          throw Error("更新版本无效，请到发布页面确认最新正式版。");
        }
        await close(candidate);
        candidate = found;
        patch({ phase: found ? "available" : "latest", release: found ? { version: found.version, notes: found.body ?? "此版本未提供更新说明。" } : null });
        failures = 0;
        nextAutomatic = now + SIX_HOURS;
      } catch (error) {
        failures++;
        nextAutomatic = now + Math.min(30 * 60_000, 60_000 * 2 ** Math.min(failures - 1, 5));
        patch({ phase: "error", error: `检查更新失败：${message(error)}` });
      }
    },
    async install() {
      if (!candidate || !state.info?.can_install || updateBusy(state) || state.phase === "installed") return;
      const update = candidate;
      patch({ phase: "downloading", downloaded: 0, total: null, error: null });
      let prepared = false;
      try {
        await update.download((event) => {
          if (event.event === "Started") patch({ total: event.data.contentLength && event.data.contentLength > 0 ? event.data.contentLength : null });
          if (event.event === "Progress") patch({ downloaded: state.downloaded + event.data.chunkLength });
        });
        // download 返回前，原生插件已验证签名和签名中的版本；只有通过后才暂停监控进入安装。
        patch({ phase: "installing" });
        await api.prepareInstall(); prepared = true;
        await update.install();
        patch({ phase: "installed" });
      } catch (error) {
        let restore = "";
        if (prepared) { try { await api.cancelInstall(); } catch { restore = "；监控状态恢复失败，请手动检查暂停开关。"; } }
        patch({ phase: "error", error: `更新失败：${message(error)}${restore}` });
      }
    },
    async restart() {
      if (state.phase !== "installed") return;
      try { await api.restart(); }
      catch (error) { patch({ error: `无法重启，请手动退出后重新打开软件：${message(error)}` }); }
    },
  };
  return controller;
}
