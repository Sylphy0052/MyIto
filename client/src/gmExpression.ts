import type { DoorsReply, DoorsView } from '../../shared/types';

export const GM_EXPRESSIONS = ['normal', 'smile', 'shy', 'angry', 'cry', 'surprised', 'confused', 'smug'] as const;
export type GmExpression = (typeof GM_EXPRESSIONS)[number];

/** 演出を出すきっかけ。表情に、考え中・エラー・結果・回答の種類を合わせたもの */
export type GmCue = 'idle' | 'thinking' | 'error' | 'win' | 'lose' | 'aborted' | DoorsReply;

const CUE_EXPRESSION: Record<GmCue, GmExpression> = {
  idle: 'normal',
  thinking: 'normal',
  error: 'cry',
  win: 'cry',
  lose: 'smug',
  aborted: 'angry',
  yes: 'smile',
  'maybe-yes': 'shy',
  unknown: 'confused',
  'maybe-no': 'confused',
  no: 'smug',
  close: 'surprised',
  correct: 'cry',
  wrong: 'smug',
};

/** 表情名と画像ファイル名の対応 (client/public/gm/<名前>.webp) */
const EXPRESSION_IMAGE: Record<GmExpression, string> = {
  normal: 'normal',
  smile: 'smile',
  shy: 'shy',
  angry: 'angry',
  cry: 'cry',
  surprised: 'surprised',
  confused: 'confused',
  smug: 'smug',
};

export function gmImageFor(expression: GmExpression): string {
  return `/gm/${EXPRESSION_IMAGE[expression]}.webp`;
}

export function expressionForCue(cue: GmCue): GmExpression {
  return CUE_EXPRESSION[cue];
}

/** AI GMの合図。結果 > エラー > 考え中 > 直近の回答 の順に決める。AIの出力は使わない */
export function gmCueFor(doors: DoorsView): GmCue {
  if (doors.outcome === 'win' || doors.outcome === 'lose' || doors.outcome === 'aborted') return doors.outcome;
  if (doors.aiError) return 'error';
  if (doors.aiBusy) return 'thinking';
  const lastReply = doors.proposals.filter((p) => p.status === 'answered' && p.reply).at(-1)?.reply;
  return lastReply ?? 'idle';
}

export function gmExpressionFor(doors: DoorsView): GmExpression {
  return expressionForCue(gmCueFor(doors));
}
