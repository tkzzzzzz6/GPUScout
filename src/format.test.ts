import { describe, expect, it } from "vitest";
import { dateLine, formatAgo, formatBytes, formatCuda, formatDuration, formatHeatValue, heatCellValue, hoursSince, matchesKeyword, nextDelay, sshCommand } from "./format";

describe("页面格式化", () => {
  it.each([[0,"凌晨"], [5,"凌晨"], [6,"上午"], [11,"上午"], [12,"中午"], [13,"中午"], [14,"下午"], [17,"下午"], [18,"晚上"], [23,"晚上"]])("%s 点的日期问候", (hour, part) => {
    expect(dateLine(new Date(2026,10,26,hour as number))).toBe(`11月26日 星期四 · ${part}`);
  });
  it.each([[0,"刚刚更新"], [4,"刚刚更新"], [5,"5 秒前更新"], [59,"59 秒前更新"], [60,"1 分钟前更新"], [125,"2 分钟前更新"]])("更新经过 %s 秒", (seconds, expected) => {
    expect(formatAgo(seconds as number)).toBe(expected);
  });
  it.each([[null,""], [118,"11.8"], [120,"12.0"], [132,"13.2"]])("CUDA %s", (value, expected) => {
    expect(formatCuda(value as number | null)).toBe(expected);
  });
  it.each([[0,"0.0 GB"], [1e9,"1.0 GB"], [10e9,"10 GB"], [1e12,"1.0 TB"]])("字节数 %s", (value, expected) => {
    expect(formatBytes(value as number)).toBe(expected);
  });
  it.each([[null,"—"], [0,"0 分钟"], [59,"0 分钟"], [60,"1 分钟"], [3599,"59 分钟"], [3600,"1 小时 0 分"], [7260,"2 小时 1 分"], [86400,"1 天 0 小时"], [90000,"1 天 1 小时"]])("运行 %s 秒", (value, expected) => {
    expect(formatDuration(value as number | null)).toBe(expected);
  });
  it("关键词忽略大小写和首尾空格", () => {
    expect(matchesKeyword("RTX 4090D", " 4090 ")).toBe(true);
    expect(matchesKeyword("A100", "a100")).toBe(true);
    expect(matchesKeyword("RTX 3080", "4090")).toBe(false);
  });
  it("SSH 已同步时用原名，未同步时用完整目标", () => {
    const server = { alias_ready:true, alias:"训练机-A100", port:2222, user:"root", host:"h.example" };
    expect(sshCommand(server)).toBe("ssh 训练机-A100");
    expect(sshCommand({ ...server, alias_ready:false })).toBe("ssh -p 2222 root@h.example");
  });
  it("刷新失败退避，恢复后回到 30 秒", () => {
    expect(nextDelay(0,false)).toBe(60_000);
    expect(nextDelay(60_000,false)).toBe(120_000);
    expect(nextDelay(600_000,false)).toBe(600_000);
    expect(nextDelay(600_000,true)).toBe(30_000);
    expect(hoursSince(null,7200)).toBeNull();
    expect(hoursSince(3600,7200)).toBe(1);
  });
  it("热力图保留未知与真实零值的区别", () => {
    const cell = { weekday:0, hour:0, samples:1, hit_ratio:0, avg_idle:2.5 };
    expect(heatCellValue(cell,"hit")).toBe(0);
    expect(heatCellValue(cell,"avg")).toBe(2.5);
    expect(formatHeatValue(null,"hit")).toBe("—");
    expect(formatHeatValue(0,"hit")).toBe("0%");
    expect(formatHeatValue(0.856,"hit")).toBe("86%");
    expect(formatHeatValue(2.54,"avg")).toBe("2.5 张");
  });
});
