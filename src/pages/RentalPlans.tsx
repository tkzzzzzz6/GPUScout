import {useEffect,useState} from 'react';
import {call,type RentalPlan} from '../api';
import {useRentalSelection} from '../RentalSelection';
import {IMAGE_SOURCE} from '../rental-images';
import {Btn,ConfirmButton,Group,Page,Row,Segmented,Sheet,useAction} from '../ui';
import {ProTemplates} from './Templates';
export default function RentalPlans({hasToken,go}:{hasToken:boolean;go:()=>void}){
 const [kind,setKind]=useState<'regular'|'pro'>('regular');const [list,setList]=useState<RentalPlan[]>([]);const [edit,setEdit]=useState<RentalPlan|null>(null);const [error,setError]=useState<string|null>(null);const {busy,run}=useAction();const selection=useRentalSelection();
 const load=()=>call<RentalPlan[]>('list_rental_plans').then(setList).catch(e=>setError(String(e)));useEffect(()=>{void load();},[]);
 return <Page><h1 className="title">租用方案</h1><Segmented layoutId="plan-kind" value={kind} onChange={setKind} items={[{id:'regular',label:'普通实例方案'},{id:'pro',label:'Pro 模板'}]}/>
 {kind==='pro'?<ProTemplates hasToken={hasToken}/>:<div style={{maxWidth:720}}><p className="lede">把常用镜像、卡数与预算留在本机。选到有卡机器后再确认租用，保存方案不会下单。</p>
 {error&&<p role="alert">{error}</p>}<Group>{list.map(p=><Row key={p.id} icon="image" label={p.name} sub={`${IMAGE_SOURCE[p.image_source]} · ${p.gpu_amount} 卡 · ${p.max_hourly==null?'未设预算':`整机 ≤ ¥${p.max_hourly}/时`}`} onClick={()=>setEdit({...p})} right={<span onClick={e=>e.stopPropagation()}><Btn small onClick={()=>{selection.apply(p);go();}}>应用并去选卡</Btn></span>}/>)}{!list.length&&<div className="empty-state">去库存选卡，在租用弹窗里可选保存常用方案；也可以直接租用。</div>}</Group><p className="group-foot">镜像可能被删除或撤销共享，租用前会重新检查。普通方案与 Pro 模板独立，原有 Pro 规则和模板保持原样。</p></div>}
 <Sheet open={!!edit} title="管理普通方案" onClose={()=>setEdit(null)} right={<button className="link-btn bold" disabled={busy} onClick={async()=>{if(edit){const id=await run(()=>call<number>('save_rental_plan',{plan:edit}),'方案已保存');if(id){setEdit(null);void load();}}}}>保存</button>}>
 {edit&&<><input className="field-input" aria-label="方案名称" maxLength={64} value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})}/><p className="group-foot">调整镜像和硬件：应用到租用弹窗，修改后保存为方案。</p><ConfirmButton icon="trash" label="删除方案" disabled={busy} onConfirm={async()=>{const ok=await run(async()=>{await call('delete_rental_plan',{id:edit.id});return true;},'方案已删除');if(ok){setEdit(null);void load();}}}/></>}
 </Sheet></Page>;
}
