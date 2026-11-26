import type { ServerView } from "./api";

export type InstancePowerAction = "start" | "start_without_gpu" | "stop";

export function instancePowerActions(server: Pick<ServerView, "kind" | "status">): InstancePowerAction[] {
  if (server.kind !== "autodl") return [];
  if (server.status === "shutdown") return ["start", "start_without_gpu"];
  return server.status === "running" ? ["stop"] : [];
}

export function instancePowerRequest(server: Pick<ServerView, "id" | "kind" | "status">, action: InstancePowerAction) {
  if (!server.id.startsWith("autodl:") || !server.id.slice(7) || !instancePowerActions(server).includes(action)) {
    throw Error("实例当前状态不支持这个操作，请刷新后重试");
  }
  return action === "stop"
    ? { command: "regular_power_off", args: { uuid: server.id.slice(7) } }
    : { command: "regular_power_on", args: { uuid: server.id.slice(7), nonGpu: action === "start_without_gpu" } };
}
