import type { RentalPlan } from './api';
export function planProblem(p:RentalPlan,region:string,gpu:string):string|null {
  if(p.region && p.region!==region)return '方案地区与当前选卡地区不同，请重新选区或解除方案偏好';
  if(p.gpu && p.gpu!==gpu)return '方案卡型与当前卡型不同，请重新选卡或解除方案偏好';
  return null;
}
export function budgetProblem(text:string,price:number,n:number):string|null {
  if(!text.trim())return null;const budget=Number(text);
  if(!Number.isFinite(budget)||budget<=0||budget>100000)return '预算需为大于 0 且不超过 100000 的每小时总价';
  return price*n>budget+1e-6?'当前整机每小时总价超过方案预算':null;
}
