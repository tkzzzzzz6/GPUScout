import {expect,test} from 'vitest';
import {planProblem,budgetProblem} from './rental-plans';
import type {RentalPlan} from './api';
test('普通方案按地区和卡型提示冲突，空偏好允许复用',()=>{
 const p:RentalPlan={id:1,name:'共享',image_source:'shared',image_uuid:'same',gpu_amount:2,max_hourly:4,region:'west',gpu:'4090'};
 expect(planProblem(p,'west','4090')).toBeNull();expect(planProblem(p,'east','4090')).toContain('地区');expect(planProblem(p,'west','5090')).toContain('卡型');expect(planProblem({...p,region:null,gpu:null},'any','any')).toBeNull();
});
test('预算按整机卡数计算且拒绝无效输入',()=>{expect(budgetProblem('',2,8)).toBeNull();expect(budgetProblem('4',2,2)).toBeNull();expect(budgetProblem('4',2.1,2)).toContain('超过');for(const s of ['abc','Infinity','0','-1'])expect(budgetProblem(s,1,1)).toBeTruthy();});
