import { useRef, useState } from "react";
import { call, inTauri } from "./api";
import { Btn, ConfirmButton, Group, Row, Segmented, Sheet, useAction, useToast } from "./ui";

type Mode = "append" | "replace";
interface Counts { rules: number; templates: number }
interface Preview extends Counts { automatic_rules: number }
interface Exported extends Counts { file_name: string; content?: string }

export function ConfigurationTransfer() {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ json: string; preview: Preview } | null>(null);
  const [mode, setMode] = useState<Mode>("append");
  const { busy, run } = useAction();
  const toast = useToast();
  const preview = async (json: string) => {
    const result = await run(() => call<Preview>("preview_configuration", { json }));
    if (result) { setMode("append"); setPending({ json, preview: result }); }
  };
  const choose = async () => {
    if (!inTauri) { input.current?.click(); return; }
    const json = await run(() => call<string | null>("pick_configuration_file"));
    if (json) await preview(json);
  };
  const exportFile = async () => {
    const result = await run(() => call<Exported | null>("export_configuration"));
    if (!result) return;
    if (!inTauri && result.content) {
      const url = URL.createObjectURL(new Blob([result.content], { type: "application/json;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = result.file_name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    toast(`已导出 ${result.rules} 条规则、${result.templates} 个模板`);
  };
  const apply = async () => {
    if (!pending) return;
    const result = await run(() => call<Counts>("import_configuration", { json: pending.json, mode }));
    if (result) { setPending(null); toast(`已导入 ${result.rules} 条规则、${result.templates} 个模板，规则全部为只提醒`); }
  };
  return <>
    <div className="group-label">规则和模板备份</div>
    <Group>
      <Row icon="doc" label="导出规则和模板" sub="保存为 JSON，可用于备份、换电脑或分享"
        right={<Btn small disabled={busy} onClick={exportFile}>导出 JSON</Btn>} />
      <Row icon="box" label="导入规则和模板" sub="先预览，再选择追加或替换；不会导入凭据和服务器"
        right={<Btn small disabled={busy} onClick={choose}>选择配置文件</Btn>} />
    </Group>
    <div className="group-foot">文件只含规则和 Pro 模板，不含普通租用方案、迁移进度或保存的凭据、服务器、余额设置、库存历史或日志。导入的规则一律改为“只提醒”，自动创建或开机需要你之后手动设置。</div>
    <input ref={input} type="file" accept=".json,application/json" aria-label="导入规则模板 JSON" hidden onChange={async (event) => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { toast("配置文件超过 2 MiB，请减少规则或模板数量后重试", true); return; }
      const json = await run(() => file.text());
      if (json !== undefined) await preview(json);
    }} />
    <Sheet open={!!pending} onClose={() => { if (!busy) setPending(null); }} title="导入预览" left={<span />}
      right={<button className="link-btn bold" disabled={busy} onClick={() => setPending(null)}>取消</button>}>
      {pending && <>
        <div className="group-label">即将导入</div>
        <Group>
          <Row icon="bell" label="提醒规则" value={`${pending.preview.rules} 条`} />
          <Row icon="cube" label="Pro 模板" value={`${pending.preview.templates} 个`} />
        </Group>
        <p className="group-foot">所有导入规则都会改为“只提醒”。{pending.preview.automatic_rules > 0 ? `文件里 ${pending.preview.automatic_rules} 条自动创建或开机规则也会降为只提醒。` : ""}导入后如需自动动作，请自行选择目标并手动开启。</p>
        <div className="group-label">导入方式</div>
        <Segmented full layoutId="import-mode" value={mode} onChange={setMode}
          items={[{ id: "append", label: "追加" }, { id: "replace", label: "替换" }]} />
        <p className={`group-foot ${mode === "replace" ? "err-text" : ""}`}>
          {mode === "replace" ? "替换会删除当前全部规则和Pro 模板，再导入文件内容。建议先导出当前配置备份。" : "保留现有规则和模板，新增文件里的内容，模板引用会自动重新对应。"}
        </p>
        <div className="row" style={{ marginTop: 20 }}>
          <ConfirmButton key={mode} className={`btn ${mode === "replace" ? "danger" : "primary"}`} disabled={busy} icon="check"
            label={mode === "replace" ? "替换现有规则和模板" : "追加导入"}
            confirmLabel={mode === "replace" ? "再点一次确认替换" : "再点一次确认导入"} onConfirm={apply} />
        </div>
      </>}
    </Sheet>
  </>;
}
