import { createRoot } from 'react-dom/client';
import { LazyMotion, MotionConfig } from 'motion/react';
import { App } from './App';
import './styles.css';

// OSの「視差効果を減らす」が有効なら、移動と回転をやめて不透明度だけで見せる
createRoot(document.getElementById('root')!).render(
  <MotionConfig reducedMotion="user">
    <LazyMotion features={() => import('./motionFeatures').then((mod) => mod.default)}>
      <App />
    </LazyMotion>
  </MotionConfig>,
);
