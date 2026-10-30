import { domMax } from 'motion/react';

// layout アニメーションに domMax が要る。初回描画を遅らせないよう、別チャンクで後から読む
export default domMax;
