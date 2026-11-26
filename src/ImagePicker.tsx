import { useId, useRef, useState } from "react";
import { call, type ImageRef, type RentalImage } from "./api";
import { usePolled } from "./hooks";
import { IMAGE_SOURCE, filterImages, imageProblem, sameImage } from "./rental-images";
import { ApiFormatHelp, Btn, Group, Row, Segmented, Select } from "./ui";

export function ImagePicker({ value, onChange, maxCuda, initialPrivate = false }: {
  value: ImageRef | null; onChange: (image: RentalImage) => void; maxCuda?: number | null; initialPrivate?: boolean;
}) {
  const layout = useId();
  const [privateMode, setPrivate] = useState(initialPrivate || (!!value && value.source !== "base"));
  const [source, setSource] = useState<"all" | "mine" | "shared">("all");
  const [search, setSearch] = useState("");
  const [framework, setFramework] = useState("");
  const [cuda, setCuda] = useState("");
  const manual = useRef(false);
  const list = usePolled(`images:${privateMode}`, () => {
    const force = manual.current; manual.current = false;
    return call<RentalImage[]>("rental_images", { private:privateMode, force });
  }, true, privateMode ? 30_000 : 3_600_000);
  const images = list.data ?? [];
  const chosen = images.find((i) => sameImage(i, value));
  const shown = filterImages(images, search, source, framework, cuda);
  const changeMode = (mode: "base" | "private") => { setPrivate(mode === "private"); setFramework(""); setCuda(""); setSource("all"); setSearch(""); };
  return <>
    <div className="group-label">镜像来源</div>
    <Segmented full layoutId={`${layout}-kind`} value={privateMode ? "private" : "base"} onChange={changeMode}
      items={[{id:"base",label:"基础镜像"},{id:"private",label:"我的 / 共享镜像"}]} />
    <div className="row" style={{ gap:8, margin:"12px 0", flexWrap:"wrap" }}>
      <input className="field-input" style={{ flex:1, minWidth:160 }} aria-label="搜索镜像" placeholder="搜索名称、框架或共享来源" value={search} onChange={(e) => setSearch(e.target.value)} />
      <Btn small icon="refresh" disabled={list.loading} onClick={() => { manual.current=true; void list.refresh(); }}>刷新镜像</Btn>
    </div>
    {privateMode && <Segmented small layoutId={`${layout}-source`} value={source} onChange={setSource} items={[{id:"all",label:"全部"},{id:"mine",label:"我的"},{id:"shared",label:"共享给我"}]} />}
    <div className="row" style={{ gap:10, margin:"12px 0", flexWrap:"wrap" }}>
      {!privateMode && <Select label="镜像框架" value={framework} onChange={setFramework} options={[{value:"",label:"全部框架"},...Array.from(new Set(images.map((i)=>i.framework).filter(Boolean))).map((v)=>({value:v,label:v}))]} />}
      <Select label="镜像 CUDA" value={cuda} onChange={setCuda} options={[{value:"",label:"全部 CUDA"},{value:"unknown",label:"版本信息未提供"},...Array.from(new Set(images.flatMap((i)=>i.cuda == null?[]:[i.cuda]))).sort((a,b)=>b-a).map((v)=>({value:String(v),label:`CUDA ${(v/10).toFixed(1)}`}))]} />
    </div>
    {list.err && <div className="group-foot err-text" role="alert">{list.err}<ApiFormatHelp message={list.err} /></div>}
    <Group>
      {!list.data && list.loading && <div className="empty-state">正在读取镜像…</div>}
      {list.data && !shown.length && <div className="empty-state">{search || source !== "all" || framework || cuda ? "没有符合筛选条件的镜像" : "还没有这类镜像"}</div>}
      {shown.map((image) => {
        const problem = imageProblem(image,maxCuda);
        return <Row key={`${image.source}:${image.uuid}`} icon="image" label={image.name} selected={sameImage(value,image)} grey={!!problem}
          sub={[IMAGE_SOURCE[image.source],image.owner ? `来自 ${image.owner}` : "",image.cuda == null ? "CUDA 信息未提供" : `CUDA ${(image.cuda/10).toFixed(1)}`,image.created_at ?? ""].filter(Boolean).join(" · ")}
          onClick={problem ? undefined : () => onChange(image)}
          right={<span className={`capsule ${problem ? "warn" : sameImage(value,image) ? "on" : ""}`}>{problem ?? (sameImage(value,image) ? "已选择" : "可选择")}</span>} />;
      })}
    </Group>
    {chosen && <details className="group-foot"><summary>已选镜像详情</summary><p>{IMAGE_SOURCE[chosen.source]} · {chosen.name}</p><p className="kv-code">UUID：{chosen.uuid}</p><p>{chosen.framework || "框架版本信息未提供"}</p></details>}
    <div className="group-foot">我的/共享镜像每 30 秒更新状态。版本缺失时不猜测；已选镜像失效或不兼容时请重新选择，软件不会自动替换环境。</div>
  </>;
}
