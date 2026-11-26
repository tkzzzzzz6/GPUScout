import { useEffect, useState } from "react";
import { call, type ServerList, type ServerView } from "./api";
import { usePolled } from "./hooks";
import { instancePowerActions, instancePowerRequest, type InstancePowerAction } from "./server-power";
import { Btn, ConfirmButton, Group, useAction } from "./ui";

const LABELS = {
  start: ["开机", "开机后开始计费，再点确认", "已发送开机请求"],
  start_without_gpu: ["无卡模式开机", "无卡开机仍会计费，再点确认", "已发送无卡模式开机请求"],
  stop: ["关机", "任务会中断，再点确认关机", "已发送关机请求"],
} as const;

export function ServerPowerControls({ server, onChanged }: { server: ServerView; onChanged: () => void }) {
  const { busy, run } = useAction();
  const [pending, setPending] = useState<string | null>(null);
  const polled = usePolled(server.id, async () => {
    const result = await call<ServerList>("list_servers");
    if (result.autodl_error) throw result.autodl_error;
    const current = result.servers.find((s) => s.id === server.id);
    if (!current) throw "实例已经释放或不在列表中，请刷新服务器列表";
    return current;
  }, server.kind === "autodl");
  const current = polled.data ?? server;
  useEffect(() => {
    if (polled.data && polled.data.status !== server.status) onChanged();
  }, [polled.data, server.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (pending !== null && current.status !== pending) setPending(null); }, [current.status, pending]);
  const act = async (action: InstancePowerAction) => {
    const ok = await run(async () => {
      const request = instancePowerRequest(current, action);
      await call(request.command, request.args); return true;
    }, LABELS[action][2]);
    if (ok) { setPending(current.status); await polled.refresh(); onChanged(); }
  };
  if (server.kind !== "autodl") return null;
  const actions = instancePowerActions(current);
  return <>
    <div className="group-label">实例开关机</div>
    <Group><div className="group-row" style={{ gap: 8, flexWrap: "wrap" }}>
      {actions.map((action) => <ConfirmButton key={action} className={action === "stop" ? "btn danger" : "btn"}
        icon={action === "stop" ? "stop" : action === "start" ? "power" : "chip"}
        label={LABELS[action][0]} confirmLabel={LABELS[action][1]} disabled={busy || pending !== null}
        onConfirm={() => act(action)} />)}
      {!actions.length && <span className="muted">{current.status === "starting" || current.status === "shutting_down" ? "实例正在开机或关机，请等待状态更新。" : "当前状态不支持开关机，请刷新确认。"}</span>}
      <Btn small icon="refresh" disabled={busy || polled.loading} onClick={() => { void polled.refresh(); }}>刷新状态</Btn>
    </div></Group>
    {pending !== null && <div className="group-foot" role="status">请求已发送，等待实例状态变化；请勿重复操作。</div>}
    {polled.err && <div className="group-foot err-text" role="alert">{polled.err}</div>}
    <div className="group-foot">开机和无卡开机都会计费，执行前会检查余额和每日次数。关机将中断当前任务、保留磁盘数据。详情开着且窗口可见时每 30 秒更新状态。</div>
  </>;
}
