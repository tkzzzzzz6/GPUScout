import { useEffect, useState } from "react";
import { call, type RestartResult } from "./api";
import { ConfirmButton, Group, useAction } from "./ui";

export function ServerRestartControls({ id, paused, onPaused }: { id: string; paused: boolean; onPaused: () => void }) {
  const { busy, run } = useAction();
  const [result, setResult] = useState<RestartResult | null>(null);
  useEffect(() => { if (!paused) setResult(null); }, [paused]);
  const restart = async () => {
    const r = await run(() => call<RestartResult>("restart_server", { id }));
    if (r) { setResult(r); onPaused(); }
  };
  return <>
    <div className="group-label">重新启动</div>
    <Group><div className="group-row" style={{ gap: 12, flexWrap: "wrap" }}>
      <span className="grow">约一分钟后重启，会中断训练任务和 SSH 连接。</span>
      <ConfirmButton icon="refresh" label="重新启动服务器" confirmLabel="会中断任务，再点确认重启" disabled={busy || paused} onConfirm={restart} />
    </div></Group>
    <div className="group-foot">支持 Linux。非 root 账户需要 /sbin/shutdown 的免密 sudo 权限；每台一分钟内最多尝试一次，失败也计入。软件不会自动重发。</div>
    {result && <Group style={{ marginTop: 12 }}><div className={`group-row ${result.status === "unknown" ? "err-text" : ""}`} role="status">{result.message}</div></Group>}
  </>;
}
