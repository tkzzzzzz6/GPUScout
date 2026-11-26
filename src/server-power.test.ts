import { describe, expect, it } from "vitest";
import { instancePowerActions, instancePowerRequest } from "./server-power";

describe("服务器页普通实例电源操作", () => {
  const server = { id: "autodl:test-instance", kind: "autodl" as const, status: "shutdown" };
  it("关机后提供两种开机，运行中只提供关机", () => {
    expect(instancePowerActions(server)).toEqual(["start", "start_without_gpu"]);
    expect(instancePowerActions({ ...server, status: "running" })).toEqual(["stop"]);
  });
  it.each(["starting", "shutting_down", "unknown", "", null])("状态 %s 不误发操作", (status) => {
    expect(instancePowerActions({ ...server, status })).toEqual([]);
    expect(() => instancePowerRequest({ ...server, status }, "start")).toThrow();
  });
  it("路由到已有受余额和次数保护的接口，无卡参数只用于无卡开机", () => {
    expect(instancePowerRequest(server, "start")).toEqual({ command: "regular_power_on", args: { uuid: "test-instance", nonGpu: false } });
    expect(instancePowerRequest(server, "start_without_gpu")).toEqual({ command: "regular_power_on", args: { uuid: "test-instance", nonGpu: true } });
    expect(instancePowerRequest({ ...server, status: "running" }, "stop")).toEqual({ command: "regular_power_off", args: { uuid: "test-instance" } });
  });
  it("拒绝不匹配状态、自有服务器或无效实例编号", () => {
    expect(() => instancePowerRequest(server, "stop")).toThrow();
    for (const invalid of [{ ...server, kind: "custom" as const }, { ...server, id: "srv:1" }, { ...server, id: "autodl:" }]) {
      expect(() => instancePowerRequest(invalid, "start")).toThrow();
    }
  });
});
