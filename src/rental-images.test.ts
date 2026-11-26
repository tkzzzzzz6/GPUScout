import { describe, expect, it } from "vitest";
import type { RentalImage } from "./api";
import { filterImages, imageProblem, sameImage } from "./rental-images";
const image:RentalImage={uuid:"id",source:"mine",name:"相同名称",status:"finished",framework:"PyTorch",cuda:null,owner:null,created_at:null,origin:"instance"};
describe("普通镜像选择",()=>{
  it("同名镜像仍按来源与ID区分",()=>{
    expect(sameImage(image,{...image,source:"shared"})).toBe(false);
    expect(sameImage(image,{...image})).toBe(true);expect(sameImage(image,null)).toBe(false);
  });
  it("未知版本保留，保存中/失败/不兼容明确阻止选择",()=>{
    expect(imageProblem(image,124)).toBeNull();
    expect(imageProblem({...image,cuda:128},124)).toContain("CUDA");
    for(const status of ["saving","failed","unknown"])expect(imageProblem({...image,status})).not.toBeNull();
  });
  it("按来源、框架、版本与多关键词筛选，不把UUID当名称",()=>{
    const list=[image,{...image,uuid:"other",source:"shared" as const,owner:"同学",cuda:124}];
    expect(filterImages(list,"相同 同学","shared","PyTorch","124")).toEqual([list[1]]);
    expect(filterImages(list,"","all","","unknown")).toEqual([image]);
    expect(filterImages(list,"other","all","","")).toEqual([]);
    expect(filterImages(list,"","mine","","")).toEqual([image]);
  });
});
