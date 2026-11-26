import { useEffect, useState } from "react";
import { call, type ImageRef, type Offer, type RentalImage, type RentResult } from "./api";
import { usePolled } from "./hooks";
import { ImagePicker } from "./ImagePicker";
import { useRentalSelection } from "./RentalSelection";
import { IMAGE_SOURCE, imageProblem, sameImage } from "./rental-images";
import { Btn, ConfirmButton, FormRow, Group, Row, Sheet, Stepper, useAction, useToast } from "./ui";

export function RentSheet({ open, onClose, region, regionName, gpu, offers, onRented }: {
  open:boolean; onClose:()=>void; region:string; regionName:string; gpu:string; offers:Offer[]; onRented:()=>void;
}) {
  const selection = useRentalSelection();
  const [image,setImage] = useState<ImageRef | null>(selection.image);
  const [n,setN] = useState(1);
  const [pick,setPick] = useState<string | null>(null);
  const [more,setMore] = useState(false);
  const [changed,setChanged] = useState<{old_yuan:number;new_yuan:number}|null>(null);
  const {busy,run} = useAction(); const toast=useToast();
  const fit=offers.filter((o)=>o.idle>=n);
  const machine=fit.find((o)=>o.machine_id===pick) ?? fit[0];
  const catalog=usePolled(`rent-image:${image?.source}:${image?.uuid}`,()=>call<RentalImage[]>("rental_images",{private:image?.source!=="base"}),open && !!image);
  const selected=catalog.data?.find((i)=>sameImage(i,image));
  const problem=selected ? imageProblem(selected,machine?.max_cuda) : image ? "所选镜像不在当前可用列表，请刷新并重新选择" : "请选择镜像";
  useEffect(()=>{if(open){setChanged(null);setMore(false);setImage(selection.image);}},[open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{setChanged(null);},[machine?.machine_id,n,image?.uuid,image?.source]);
  const price=changed?.new_yuan ?? machine?.price_yuan ?? 0, hourly=price*n;
  const rent=async()=>{
    if(!machine || !selected || problem)return;
    const result=await run(()=>call<RentResult>("rent_instance",{region,gpu,machineId:machine.machine_id,gpuAmount:n,
      imageUuid:selected.uuid,imageSource:selected.source,expectedPrice:price,acceptPrice:false}));
    if(!result)return;
    if(result.status==="price_changed"){setChanged(result);return;}
    toast("已下单，实例正在开机，到「我的实例」或「服务器」查看");onRented();onClose();
  };
  return <Sheet open={open} onClose={onClose} title={`租用 ${gpu}`} left={<span />} right={<button className="link-btn bold" disabled={busy} onClick={onClose}>取消</button>}>
    <p className="group-foot">{regionName}，按量计费。下单前会重新核对主机、镜像和价格。付费扩容盘等存储费用可能在关机后继续产生。</p>
    <div className="group-label">单机配置</div>
    <Group><FormRow icon="gpu_s" label="单机卡数"><Stepper value={n} min={1} max={8} unit="卡" onChange={setN} /></FormRow></Group>
    <div className="group-label">当前可租主机</div>
    <Group>
      {!fit.length && <div className="empty-state">没有单台空闲 {n} 张卡的机器，请减少卡数或刷新库存。</div>}
      {(more?fit:fit.slice(0,6)).map((o)=><Row key={o.machine_id} icon="server" label={`¥${o.price_yuan.toFixed(2)} / 卡·时`}
        sub={`${o.machine_alias || o.machine_id} · 空闲 ${o.idle} 张 · ${o.max_cuda ? `驱动 CUDA ≤ ${(o.max_cuda/10).toFixed(1)}` : "驱动信息未提供"}`}
        selected={machine?.machine_id===o.machine_id} onClick={()=>setPick(o.machine_id)} right={machine?.machine_id===o.machine_id?<span className="capsule on">已选</span>:null} />)}
      {fit.length>6 && <div className="group-row"><Btn small onClick={()=>setMore(!more)}>{more?"收起":"显示全部主机"}</Btn></div>}
    </Group>
    {open && <ImagePicker value={image} maxCuda={machine?.max_cuda} onChange={(i)=>{const ref={uuid:i.uuid,source:i.source};setImage(ref);selection.select(ref);}} />}
    <div className="group-label">租用确认</div>
    <Group><Row icon="image" label={selected?.name ?? "尚未选择可用镜像"} sub={selected ? `${IMAGE_SOURCE[selected.source]} · ${selected.cuda == null ? "CUDA 信息未提供" : `CUDA ${(selected.cuda/10).toFixed(1)}`}` : undefined} /></Group>
    {(problem || catalog.err) && <p className="group-foot err-text" role="alert">{catalog.err ?? problem}</p>}
    {changed && <p className="group-foot" role="alert">主机价格从 ¥{changed.old_yuan.toFixed(2)} 涨至 ¥{changed.new_yuan.toFixed(2)} / 卡·时，请按新总价再次确认。</p>}
    <div className="rent-total"><span className="num">{n} 卡合计 <b>¥{hourly.toFixed(2)} / 小时</b></span>
      <ConfirmButton icon="power" className="btn primary" label="租用并开机" confirmLabel={`合计 ¥${hourly.toFixed(2)}/时，再点确认`}
        disabled={busy || !machine || !selected || !!problem || catalog.loading || !!catalog.err} onConfirm={rent} />
    </div>
    <div className="group-foot">保存或选择镜像配置不会下单；确认租用并开机后开始计费。多卡必须在同一台主机上。</div>
  </Sheet>;
}
