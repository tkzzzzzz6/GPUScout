// 界面共用的纯格式化逻辑，避免价格、时间和连接命令在页面中各自实现。
import type { HeatCell, ServerView } from "./api";

export function dateLine(date = new Date()) {
  const hour = date.getHours();
  const part = hour < 6 ? "凌晨" : hour < 12 ? "上午" : hour < 14 ? "中午" : hour < 18 ? "下午" : "晚上";
  return `${date.getMonth() + 1}月${date.getDate()}日 星期${"日一二三四五六"[date.getDay()]} · ${part}`;
}

export function formatAgo(seconds: number) {
  if (seconds < 5) return "刚刚更新";
  if (seconds < 60) return `${seconds} 秒前更新`;
  return `${Math.floor(seconds / 60)} 分钟前更新`;
}

export const formatCuda = (value: number | null) => value == null ? "" : (value / 10).toFixed(1);
export const matchesKeyword = (name: string, keyword: string) => name.toLowerCase().includes(keyword.trim().toLowerCase());
export const formatBytes = (bytes: number) => bytes >= 1e12 ? `${(bytes / 1e12).toFixed(1)} TB` : `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;
export const formatDuration = (seconds: number | null) => seconds == null ? "—" : seconds >= 86400 ? `${Math.floor(seconds / 86400)} 天 ${Math.floor((seconds % 86400) / 3600)} 小时` : seconds >= 3600 ? `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分` : `${Math.floor(seconds / 60)} 分钟`;
export const sshCommand = (server: Pick<ServerView, "alias_ready" | "alias" | "port" | "user" | "host">) => server.alias_ready ? `ssh ${server.alias}` : `ssh -p ${server.port} ${server.user}@${server.host}`;

/** 查询成功恢复 30 秒，失败翻倍至多 10 分钟；不会因为手动刷新而突破最小间隔。 */
export function nextDelay(previous: number, ok: boolean) {
  return ok ? 30_000 : Math.min(Math.max(previous, 30_000) * 2, 600_000);
}

export const hoursSince = (timestamp: number | null, now = Date.now() / 1000) => timestamp ? (now - timestamp) / 3600 : null;
export type HeatMetric = "hit" | "avg";
export const heatCellValue = (cell: HeatCell, metric: HeatMetric) => metric === "hit" ? cell.hit_ratio : cell.avg_idle;
export const formatHeatValue = (value: number | null | undefined, metric: HeatMetric) => value == null ? "—" : metric === "hit" ? `${Math.round(value * 100)}%` : `${value.toFixed(1)} 张`;
