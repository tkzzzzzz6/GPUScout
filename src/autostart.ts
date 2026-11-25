export interface AutostartApi {
  isEnabled(): Promise<boolean>;
  enable(): Promise<void>;
  disable(): Promise<void>;
}

export interface AutostartState {
  enabled: boolean | null;
  busy: boolean;
  error: string | null;
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** 系统状态才是事实来源；操作失败后也要回读，不能把“读不到”当成关闭。 */
export function createAutostartController(api: AutostartApi) {
  let state: AutostartState = { enabled: null, busy: false, error: null };
  const listeners = new Set<() => void>();
  const update = (next: AutostartState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const read = async (operationError: string | null = null, expected?: boolean) => {
    try {
      const enabled = await api.isEnabled();
      const mismatch = expected !== undefined && enabled !== expected
        ? "系统状态未改变，请重试，或检查系统的启动项设置。" : null;
      update({ enabled, busy: false, error: operationError ?? mismatch });
    } catch (error) {
      update({ enabled: null, busy: false, error: [operationError, `无法读取开机自启动状态：${message(error)}`].filter(Boolean).join("；") });
    }
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async refresh() {
      if (state.busy) return;
      update({ ...state, busy: true, error: null });
      await read();
    },
    async setEnabled(on: boolean) {
      // 同步占用，防止 React 重新渲染前的第二次点击发起相反操作。
      if (state.busy || state.enabled === null) return;
      update({ ...state, busy: true, error: null });
      let error: string | null = null;
      try {
        await (on ? api.enable() : api.disable());
      } catch (cause) {
        error = `无法${on ? "开启" : "关闭"}开机自启动：${message(cause)}`;
      }
      await read(error, on);
    },
  };
}
