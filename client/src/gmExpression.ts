import type { DoorsReply, DoorsView } from '../../shared/types';

export const GM_EXPRESSIONS = ['normal', 'smile', 'shy', 'angry', 'cry', 'surprised', 'confused'] as const;
export type GmExpression = (typeof GM_EXPRESSIONS)[number];

const REPLY_EXPRESSION: Record<DoorsReply, GmExpression> = {
  yes: 'smile',
  'maybe-yes': 'smile',
  unknown: 'confused',
  'maybe-no': 'confused',
  no: 'normal',
  correct: 'surprised',
  close: 'shy',
  wrong: 'smile',
};

export function expressionForReply(reply: DoorsReply): GmExpression {
  return REPLY_EXPRESSION[reply];
}

/** AI GMの表情。結果 > エラー > 考え中 > 直近の回答 の順に決める。AIの出力は使わない */
export function gmExpressionFor(doors: DoorsView): GmExpression {
  if (doors.outcome === 'win') return 'cry';
  if (doors.outcome === 'lose') return 'smile';
  if (doors.outcome === 'aborted') return 'angry';
  if (doors.aiError) return 'cry';
  if (doors.aiBusy) return 'confused';
  const lastReply = doors.proposals.filter((p) => p.status === 'answered' && p.reply).at(-1)?.reply;
  return lastReply ? expressionForReply(lastReply) : 'normal';
}
