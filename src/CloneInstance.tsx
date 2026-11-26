import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {call,LINKS,openExternal,type CloneSource,type RegularInstance,type RentResult,type Snapshot} from './api';
import {useGpuPrice,usePolled} from './hooks';
import {budgetProblem} from './rental-plans';
import {Btn,ConfirmButton,FormRow,Group,Row,Select,Sheet,Stepper,useAction} from './ui';
export function CloneInstance({uuid,status}:{uuid:string;status:string}){
 const [open,setOpen]=useState(false);const stopped=['shutdown','shutdown_by_starting_error','shutdown_by_running_error'].includes(status);
 return <><div className="group-label">同地区克隆</div><p className="group-foot">换到同地区其他主机，复制系统环境。源实例需已关机，克隆不会释放源实例。</p><Btn small icon="copy" disabled={!stopped} onClick={()=>setOpen(true)}>克隆到同地区主机</Btn>{createPortal(<Sheet open={open} onClose={()=>setOpen(false)} title="普通实例同地区克隆" right={<button className="link-btn bold" onClick={()=>setOpen(false)}>关闭克隆</button>}>{open&&<CloneEditor uuid={uuid}/>}</Sheet>,document.body)}</>;
}
function CloneEditor({uuid}:{uuid:string}){
 const source=usePolled(`clone-source:${uuid}`,()=>call<CloneSource>('regular_clone_source',{uuid}),true);
 const snap=usePolled('clone-stock',()=>call<Snapshot>('get_snapshot'),true);
 const [gpu,setGpu]=useState('');const [n,setN]=useState(1);const [copyData,setCopy]=useState(false);const [pick,setPick]=useState('');const [budget,setBudget]=useState('');const [changed,setChanged]=useState<number|null>(null);
 const [result,setResult]=useState<{status:'created';instance_uuid:string}|{status:'unknown';message:string}|null>(null);const {busy,run}=useAction();
 useEffect(()=>{if(source.data)setGpu(g=>g||source.data!.gpu);},[source.data]);
 const prices=useGpuPrice(source.data?.region??'',gpu,!!source.data&&!!gpu&&!result);
 const fit=prices.data?.offers.filter(o=>o.idle>=n)??[];const machine=fit.find(o=>o.machine_id===pick)??fit[0];
 useEffect(()=>setChanged(null),[machine?.machine_id,n,copyData]);const price=changed??machine?.price_yuan??0;
 const problem=budgetProblem(budget,price,n);
 const target=usePolled(`clone-target:${result?.status==='created'?result.instance_uuid:''}`,()=>call<RegularInstance[]>('list_regular_instances'),result?.status==='created');
 const newInst=result?.status==='created'?target.data?.find(i=>i.uuid===result.instance_uuid):null;
 if(!source.data)return <><p role={source.err?'alert':undefined}>{source.err??'正在核对源实例与地区…'}</p><Btn small disabled={source.loading} onClick={()=>void source.refresh()}>重新核对</Btn><Btn small icon="external" onClick={()=>openExternal(LINKS.console)}>去控制台</Btn></>;
 const src=source.data;const gpus=Array.from(new Set([src.gpu,...(snap.data?.regions.find(r=>r.region===src.region)?.items.map(i=>i.gpu_name)??[])]));
 return <><Group><Row icon="server" label={`源实例：${src.name||src.uuid}`} sub={`${src.region_name} · ${src.gpu}`}/><Row icon="image" label="系统盘：完整复制（必选）" sub="不会自动关停、释放或清理源实例"/></Group>
 {result?<><div className="group-label">克隆结果</div>{result.status==='unknown'?<p role="alert" className="group-foot err-text">{result.message}</p>:<><p role="status" className="group-foot">已提交，新实例：<span className="kv-code">{result.instance_uuid}</span></p><p className="group-foot">{newInst?`平台状态：${newInst.status} ${newInst.sub_status}`:'等待新实例出现在列表，尚未确认复制完成'}。请检查系统环境{copyData?'与数据盘':''}后再自行处理源实例。</p>{target.err&&<p role="alert">读取新实例失败：{target.err}</p>}</>}<Btn small icon="external" onClick={()=>openExternal(LINKS.console)}>核对控制台实例与订单</Btn></>:<>
 <div className="group-label">复制范围</div><Group><div className="group-row"><label><input type="checkbox" checked={copyData} onChange={e=>setCopy(e.target.checked)}/> 克隆后复制数据盘</label></div></Group>
 <p className="group-foot">{copyData?`包含数据盘；目标将同步扩容 ${(src.expand_bytes/1024**3).toFixed(0)} GB，可能产生额外存储费。复制耗时取决于数据量，运行前请核验。`:'仅复制系统盘；数据盘文件不会一起带过去。'} 不迁移原 SSH 地址，不自动覆盖其他已有实例。</p>
 <div className="group-label">目标：{src.region_name}（锁定同地区）</div><Group><FormRow icon="gpu_s" label="卡型"><Select label="克隆目标卡型" value={gpu} onChange={setGpu} options={gpus.map(g=>({value:g,label:g}))}/></FormRow><FormRow icon="number" label="单机卡数"><Stepper value={n} min={1} max={8} unit="卡" onChange={setN}/></FormRow><FormRow icon="wallet" label="GPU 整机预算 / 时"><input aria-label="克隆整机预算" className="inline-input" value={budget} placeholder="不限" onChange={e=>setBudget(e.target.value)}/></FormRow></Group>
 <div className="row" style={{margin:'12px 0'}}><Btn small disabled={prices.loading} onClick={()=>void prices.refresh()}>刷新可租主机</Btn></div>{prices.err&&<p role="alert">{prices.err}</p>}
 <Group>{fit.map(o=><Row key={o.machine_id} icon="server" label={`${o.machine_alias||o.machine_id} · ¥${o.price_yuan.toFixed(2)}/卡·时`} sub={`空闲 ${o.idle} 张 · ${o.max_cuda==null?'驱动信息未提供':`CUDA ≤ ${o.max_cuda/10}`}`} selected={o.machine_id===machine?.machine_id} onClick={()=>setPick(o.machine_id)}/>)}{!prices.loading&&!fit.length&&<div className="empty-state">当前没有满足单机卡数的目标，请稍后刷新</div>}</Group>
 {changed!=null&&<p className="group-foot" role="alert">价格上涨至 ¥{changed.toFixed(2)}/卡·时，请重新确认。</p>}{problem&&<p className="group-foot err-text" role="alert">{problem}</p>}
 <p className="group-foot">GPU 合计 ¥{(price*n).toFixed(2)}/时；另有可能的存储费。后端会重新检查关机状态、同地区身份、架构、CUDA、库存、余额及价格。</p>
 <ConfirmButton icon="copy" className="btn primary" label="克隆并创建新实例" confirmLabel={`GPU ¥${(price*n).toFixed(2)}/时及可能存储费，确认`} disabled={busy||!machine||!!problem||!!prices.err||source.loading} onConfirm={async()=>{if(!machine)return;const r=await run(()=>call<RentResult|{status:'unknown';message:string}>('clone_regular_instance',{uuid,region:src.region,gpu,machineId:machine.machine_id,gpuAmount:n,copyData,expectedPrice:price,maxHourly:budget.trim()?Number(budget):null}));if(r?.status==='price_changed')setChanged(r.new_yuan);else if(r)setResult(r);}}/>
 </>}
 <p className="group-foot">跨地区请使用系统盘镜像迁移，普通克隆不能跨地区。结果未知时不要重复提交；先核对控制台。</p></>;
}
