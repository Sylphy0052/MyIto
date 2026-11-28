import { Component, lazy, type ComponentType, type ReactNode } from 'react';

const RELOAD_KEY = 'chunk-reload-at';

// チャンク取得失敗時、1回だけ再読込する。2回目は再読込せず失敗表示にする。
export function lazyGame<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await load();
      sessionStorage.removeItem(RELOAD_KEY);
      return mod;
    } catch (e) {
      if (!sessionStorage.getItem(RELOAD_KEY)) {
        sessionStorage.setItem(RELOAD_KEY, '1');
        location.reload();
        return new Promise<never>(() => {});
      }
      throw e;
    }
  });
}

export class ChunkErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="notice">
        画面の読み込みに失敗しました。<button className="small" onClick={() => location.reload()}>再読込</button>
      </div>
    );
  }
}

export function GameLoading() {
  return <div className="notice" style={{ minHeight: 240 }}>読み込み中…</div>;
}
