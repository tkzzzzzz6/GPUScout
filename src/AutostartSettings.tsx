import { useEffect, useState, useSyncExternalStore } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { inTauri } from "./api";
import { createAutostartController } from "./autostart";
import { Btn, FormRow, Group, Switch } from "./ui";

export function AutostartSettings() {
  const [controller] = useState(() => createAutostartController({ isEnabled, enable, disable }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { if (inTauri) void controller.refresh(); }, [controller]);
  return (
    <>
      <div className="group-label">系统</div>
      {inTauri ? (
        <>
          <Group>
            <FormRow icon="sparkle" label="开机时自动启动并隐藏到托盘">
              {state.enabled === null
                ? <span className="muted" role="status">{state.busy || !state.error ? "正在读取…" : "状态未知"}</span>
                : <Switch checked={state.enabled} disabled={state.busy} label="开机自启" onChange={(on) => { void controller.setEnabled(on); }} />}
            </FormRow>
          </Group>
          <div className="group-foot" role={state.error ? "alert" : "status"}>
            {state.error ? <span className="err-text">{state.error}</span>
              : state.busy ? "正在确认系统启动项…" : "开启后在下次登录系统时生效；此开关立即保存，不需要再点“保存设置”。"}
          </div>
          {state.error && <Btn icon="refresh" disabled={state.busy} onClick={() => { void controller.refresh(); }}>重新读取状态</Btn>}
        </>
      ) : <div className="group-foot">桌面版支持开机自启动。浏览器演示不修改系统启动项，请在软件的“设置 → 系统”中开启。</div>}
    </>
  );
}
