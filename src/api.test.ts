import { describe, expect, it } from "vitest";
import { API_FORMAT_ERROR_PREFIX, LINKS, errText, fmtClock, fmtTime, gpuAlias, isApiFormatError, isGpu, regionOptions, timeFieldTs, yuan } from "./api";

describe("卡型名称和区域选项", () => {
  it.each([["vGPU-32GB", "4080S 32G"], ["vGPU-48GB", "4090 48G"], ["vGPU-48GB-350W", "3090 48G"]])("%s 显示正确的物理卡型", (name, alias) => {
    expect(gpuAlias(name)).toBe(alias);
  });
  it("未知显卡没有误导性的别名", () => { expect(gpuAlias("RTX 5090")).toBeUndefined(); });
  it.each([["CPU", false], ["CPU-close-HT", false], ["cpu", false], ["RTX 4090", true], ["vGPU-48GB", true]])("%s 是否是 GPU", (name, expected) => {
    expect(isGpu(name as string)).toBe(expected);
  });
  it("常规区域优先，保留各组内的原始顺序", () => {
    const input = [{ value:"v100", label:"V100专区" }, { value:"west", label:"西北B区" }, { value:"enterprise", label:"西北企业区" }, { value:"bj", label:"北京B区" }];
    expect(regionOptions(input)).toEqual([
      { value:"west", label:"西北B区", group:"常规区域" }, { value:"bj", label:"北京B区", group:"常规区域" },
      { value:"v100", label:"V100专区", group:"专区" }, { value:"enterprise", label:"西北企业区", group:"专区" },
    ]);
    expect(input[0].value).toBe("v100");
  });
});

describe("外链", () => {
  it.each([
    ["proConsole", "https://www.autodl.com/console/instance/pro/list"],
    ["devToken", "https://www.autodl.com/console/center/settings/token"], ["proDocs", "https://www.autodl.com/docs/instance_pro_api/"],
    ["market", "https://www.autodl.com/market/list"], ["console", "https://www.autodl.com/console/instance/list"],
    ["issues", "https://github.com/tkzzzzzz6/GPUScout/issues"], ["releases", "https://github.com/tkzzzzzz6/GPUScout/releases/latest"],
  ] as const)("%s 指向正确的 HTTPS 页面", (key, expected) => {
    expect(LINKS[key]).toBe(expected);
    expect(new URL(LINKS[key]).protocol).toBe("https:");
  });
});

describe("金额、时间和错误", () => {
  it.each([[null,"—"], [undefined,"—"], [0,"¥0.00"], [1.2,"¥1.20"], [187.46,"¥187.46"]])("金额 %s", (value, expected) => {
    expect(yuan(value as number | null | undefined)).toBe(expected);
  });
  it("格式化秒级时间戳和缺省值", () => {
    const timestamp = Date.parse("2026-11-26T08:30:00Z") / 1000;
    expect(fmtClock(timestamp)).toBe("08:30");
    expect(fmtTime(timestamp)).toContain("2026/11/26");
    expect(fmtTime(timestamp)).toContain("08:30:00");
    expect(fmtTime(null)).toBe("—");
  });
  it.each([null, undefined, "invalid", { Time:"invalid", Valid:true }, { Time:"2026-11-26T08:30:00Z", Valid:false }])("无效或未生效的时间返回 null", (value) => {
    expect(timeFieldTs(value)).toBeNull();
  });
  it("支持字符串、Go 时间对象和 epoch", () => {
    expect(timeFieldTs("1970-01-01T00:00:00Z")).toBe(0);
    expect(timeFieldTs({ Time:"2026-11-26T16:30:00+08:00", Valid:true })).toBe(1_795_681_800);
  });
  it("识别嵌套的格式错误，网络错误不误判", () => {
    expect(isApiFormatError(`区域查询失败：${API_FORMAT_ERROR_PREFIX}（wallet.assets）`)).toBe(true);
    expect(isApiFormatError("网络超时")).toBe(false);
    expect(isApiFormatError(null)).toBe(false);
    expect(errText(new Error("出错了"))).toBe("出错了");
  });
});
