import { useEffect, useState } from "react";
import { call, type SshConfigDocument, type SshConfigSaved } from "./api";
import { Btn, ConfirmButton, Group, Sheet, useToast } from "./ui";

export function SshConfigEditor({ onClose }: { onClose: () => void }) {
  const [document, setDocument] = useState<SshConfigDocument | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const toast = useToast();
  const dirty = !!document && text !== document.content;
  const load = async () => {
    setBusy(true); setError(null);
    try {
      const result = await call<SshConfigDocument>("read_ssh_config");
      setDocument(result); setText(result.content); setEditing(false); setDiscard(false);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  const close = () => { if (!busy) { if (dirty) setDiscard(true); else onClose(); } };
  const save = async () => {
    if (!document) return;
    setBusy(true); setError(null);
    try {
      const result = await call<SshConfigSaved>("save_ssh_config", { original: document.exists ? document.content : null, content: text });
      setDocument(result.document); setText(result.document.content); setEditing(false); setDiscard(false);
      toast(!result.changed ? "配置没有变化" : result.backup_path ? `已保存，原文件备份在 ${result.backup_path}` : "已创建 SSH 配置");
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <Sheet open title="本机 SSH 配置" onClose={close} left={<span />}
    right={<button className="link-btn bold" disabled={busy} onClick={close}>完成</button>}>
    <div className="group-label">{document?.path ?? "~/.ssh/config"}</div>
    <p className="group-foot">预览和编辑本机主配置文件。保存前会单独备份；Include 引用的文件不会一起修改。软件管理段会被下次同步覆盖，如需手动维护请先关闭自动同步。</p>
    {error && <Group><div className="group-row err-text" role="alert">{error}</div></Group>}
    {document && <>
      {!document.exists && <p className="group-foot">文件还不存在，保存后会创建。</p>}
      <textarea className="field-input kv-code" aria-label="SSH 配置内容" rows={20} spellCheck={false}
        readOnly={!editing || busy} value={text} onChange={(e) => setText(e.target.value)} />
      <p className="group-foot">支持 UTF-8，最多 1 MiB。保存不会测试 SSH 连接，请确认配置语法正确。不要将含敏感信息的配置截图或公开分享。</p>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        {!editing ? <Btn icon="gear" disabled={busy} onClick={() => setEditing(true)}>编辑配置</Btn> : <>
          <ConfirmButton className="btn primary" label="保存配置" confirmLabel={document.exists ? "备份后保存，再点确认" : "创建配置，再点确认"} disabled={busy || (!dirty && document.exists)} onConfirm={save} />
          <Btn disabled={busy} onClick={() => { setText(document.content); setEditing(false); setError(null); setDiscard(false); }}>取消编辑</Btn>
        </>}
        {dirty ? <ConfirmButton label="重新加载" confirmLabel="放弃修改并重新加载" disabled={busy} onConfirm={load} />
          : <Btn icon="refresh" disabled={busy} onClick={load}>重新加载</Btn>}
      </div>
    </>}
    {!document && <Btn disabled={busy} onClick={load}>{busy ? "正在读取…" : "重新加载"}</Btn>}
    {discard && <Group style={{ marginTop: 16 }}><div className="group-row" role="alert">
      <span className="grow">有尚未保存的修改。</span>
      <ConfirmButton label="放弃修改并关闭" confirmLabel="确认放弃并关闭" onConfirm={onClose} />
    </div></Group>}
  </Sheet>;
}
