import { Component, type ErrorInfo, type ReactNode } from "react";
import { call, inTauri } from "./api";
import type { PageId } from "./App";
import { Icon } from "./icons";
import { Btn, Group, Page } from "./ui";

/**
 * 每一页外面包一层：页面渲染抛异常时只把这一页换成错误提示，顶栏和导航照常能用。
 * 没有它的话，一个页面出错（比如接口字段变了，null 上调了 .toFixed）整个 React 树都会卸载，窗口白屏。
 * App 里用 key={page} 挂载，切到别的页再切回来就是新的实例，自然恢复。
 */
export class PageBoundary extends Component<{ page: PageId; children: ReactNode }, { error: Error | null; nonce: number }> {
  state = { error: null as Error | null, nonce: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const e = error instanceof Error ? error : new Error(String(error));
    // 只记错误本身和出错的组件名，组件栈里的文件路径没用
    const where = info.componentStack?.match(/at (\w+)/)?.[1];
    const message = `${e.name}: ${e.message}${where ? `（${where}）` : ""}`;
    call("log_ui_error", { page: this.props.page, message }).catch(() => {});
  }

  render() {
    const { error, nonce } = this.state;
    if (!error) return <DemoCrash key={nonce} page={this.props.page}>{this.props.children}</DemoCrash>;
    return (
      <Page>
        <h1 className="title">这一页出错了</h1>
        <p className="lede">别的页面不受影响，后台监控也还在跑。可以先重新加载这一页；反复出现的话，把下面的错误信息贴到 issue 里。</p>
        <div style={{ maxWidth: 760 }}>
          <Group>
            <div className="group-row" style={{ alignItems: "flex-start" }}>
              <Icon name="warn" size={22} style={{ color: "var(--red)", flexShrink: 0, marginTop: 1 }} />
              <div className="grow">
                <div className="label" style={{ wordBreak: "break-word" }}>{error.name}: {error.message}</div>
                <div className="sub">已写进「日志」页</div>
              </div>
            </div>
          </Group>
          <div style={{ marginTop: 16 }}>
            <Btn primary icon="refresh" onClick={() => { disarmed.add(this.props.page); this.setState({ error: null, nonce: nonce + 1 }); }}>重新加载这一页</Btn>
          </div>
        </div>
      </Page>
    );
  }
}

// 演示模式专用：地址带 ?crash=<页面>（如 ?crash=stock）时这一页渲染会抛错，用来检查错误提示；
// 点过「重新加载这一页」后就不再抛。软件窗口里（inTauri）永远不会触发。
// 不能「抛一次就停」：React 出错后会自动重试渲染一次，第二次成功的话错误提示就看不到了。
const disarmed = new Set<string>();
function DemoCrash({ page, children }: { page: PageId; children: ReactNode }) {
  if (!inTauri && !disarmed.has(page) && new URLSearchParams(location.search).get("crash") === page) {
    throw new TypeError("Cannot read properties of null (reading 'toFixed')");
  }
  return <>{children}</>;
}
