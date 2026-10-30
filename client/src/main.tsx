import { createRoot } from 'react-dom/client';
import { LazyMotion, MotionConfig, domMax } from 'motion/react';
import { App } from './App';
import './styles.css';

// OSの「視差効果を減らす」が有効なら、移動と回転をやめて不透明度だけで見せる。
// features は同期で渡す。遅延読込にすると、チャンク取得に失敗したとき initial の opacity 0 のまま画面が出ない
createRoot(document.getElementById('root')!).render(
  <MotionConfig reducedMotion="user">
    <LazyMotion features={domMax}>
      <App />
    </LazyMotion>
  </MotionConfig>,
);
