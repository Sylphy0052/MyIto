import { Component, lazy, type ComponentType, type ReactNode } from 'react';

const RELOAD_KEY = 'chunk-reload-at';

// 動的importの失敗だけを区別するための印。
class ChunkLoadError extends Error {
  constructor(readonly cause: unknown) {
    super('chunk load failed');
  }
}

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
      throw new ChunkLoadError(e);
    }
  });
}

export class ChunkErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // チャンク取得失敗以外の描画例外は握りつぶさず上位へ再送出する。
    if (!(error instanceof ChunkLoadError)) throw error;
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
