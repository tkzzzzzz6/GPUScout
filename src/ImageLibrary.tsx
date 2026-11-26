import { useState } from "react";
import type { ImageRef } from "./api";
import { ImagePicker } from "./ImagePicker";
import { useRentalSelection } from "./RentalSelection";
import { Btn, Sheet } from "./ui";
export function ImageLibrary({ go }: { go: () => void }) {
  const [open,setOpen] = useState(false);
  const selection = useRentalSelection();
  const [chosen,setChosen] = useState<ImageRef | null>(null);
  return <>
    <Btn small icon="image" onClick={()=>{setChosen(null);setOpen(true);}}>镜像库</Btn>
    <Sheet open={open} onClose={()=>setOpen(false)} title="普通实例镜像库" left={<span />} right={<button className="link-btn bold" onClick={()=>setOpen(false)}>完成</button>}>
      {open && <ImagePicker initialPrivate value={chosen} onChange={(image)=>setChosen({uuid:image.uuid,source:image.source})} />}
      <div className="row" style={{marginTop:16}}><Btn primary disabled={!chosen} onClick={()=>{selection.select(chosen);setOpen(false);go();}}>用所选镜像去选卡</Btn></div>
      <p className="group-foot">可先筛选和查看详情。去库存选卡后租用时带入所选来源与镜像；此处选择不会下单。</p>
    </Sheet>
  </>;
}
