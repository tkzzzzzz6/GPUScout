import { useState } from "react";
import { call } from "./api";
import { ConfirmButton, Group, useAction, useToast } from "./ui";
export function SaveRegularImage({ uuid, status }: { uuid:string; status:string }) {
  const [name,setName]=useState(""); const [sent,setSent]=useState(false);
  const {busy,run}=useAction();const toast=useToast();
  const stopped=["shutdown","shutdown_by_starting_error","shutdown_by_running_error"].includes(status);
  return <>
    <div className="group-label">保存系统盘镜像</div>
    <Group><div className="group-row"><input className="inline-input" aria-label="普通实例镜像名称" placeholder="如 qwen-env-v3，最多32字" maxLength={32} value={name} onChange={(e)=>{setName(e.target.value);setSent(false);}} /></div></Group>
    <p className="group-foot">保存已安装的系统环境，不包含独立数据盘。镜像存储可能产生费用，以平台计费规则为准。{!stopped && "请先手动关机，软件不会自动中断训练。"}</p>
    <ConfirmButton icon="image" label="保存镜像" confirmLabel="同意镜像存储计费，再点确认" disabled={busy || !stopped || !name.trim() || sent}
      onConfirm={async()=>{const ok=await run(async()=>{await call("save_regular_image",{uuid,name:name.trim()});return true;});if(ok){setSent(true);toast("镜像保存请求已提交，请在镜像库查看状态");}}} />
    {sent && <p className="group-foot" role="status">请求已提交，尚未代表保存完成；打开镜像库查看“保存中 / 就绪 / 保存失败”。</p>}
  </>;
}
