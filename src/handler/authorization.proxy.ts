import type { FilePartInput, TextPartInput } from '@opencode-ai/sdk';

export const AUTH_TIMEOUT_MS = 15 * 60 * 1000;

export type PendingAuthorizationState = {
  key: string;
  adapterKey: string;
  chatId: string;
  senderId: string;
  sessionId: string;
  blockedReason: string;
  source: 'bridge.incoming' | 'bridge.question.resume';
  deferredParts: Array<TextPartInput | FilePartInput>;
  createdAt: number;
  dueAt: number;
};

function normalizeToken(value: string): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[`'"“”‘’]/g, '');
}

export function parseAuthorizationReply(
  value: string,
): 'resume_blocked' | 'start_new_session' | 'unknown' | 'empty' {
  const token = normalizeToken(value);
  if (!token) return 'empty';

  const resumeSet = new Set([
    '1',
    'y',
    'yes',
    'ok',
    'okay',
    'continue',
    'resume',
    '继续',
    '继续原会话',
    '已授权',
    '授权好了',
    '授权完成',
    '好了',
    '完成',
  ]);
  if (resumeSet.has(token)) return 'resume_blocked';

  const newSet = new Set([
    '2',
    'new',
    'new session',
    'new topic',
    'skip',
    'start new',
    '新会话',
    '新话题',
    '跳过',
    '先聊别的',
    '换个话题',
  ]);
  if (newSet.has(token)) return 'start_new_session';

  return 'unknown';
}

export function renderAuthorizationPrompt(state: PendingAuthorizationState): string {
  const lines: string[] = [];
  lines.push('## Question');
  lines.push('检测到当前会话需要你在 OpenCode 网页完成权限授权。');
  if (state.blockedReason) {
    lines.push(`原因：${state.blockedReason}`);
  }
  lines.push('');
  lines.push('请回复：');
  lines.push('1. 已授权，继续当前会话');
  lines.push('2. 先不授权，切换新会话继续');
  lines.push('');
  lines.push('如果你直接发送新话题，我会默认切换到新会话继续。');
  return lines.join('\n');
}

export function renderAuthorizationReplyHint(): string {
  return '请回复 `1`（继续当前会话）或 `2`（切换新会话），也可以直接发送新话题。';
}

export function renderAuthorizationStatus(
  mode: 'resume' | 'switch-new' | 'timeout' | 'still-blocked',
): string {
  if (mode === 'resume') {
    return '## Status\n✅ 已收到，继续在原会话处理中。';
  }
  if (mode === 'switch-new') {
    return '## Status\n✅ 检测到你要继续新话题，已切换新会话。';
  }
  if (mode === 'still-blocked') {
    return '## Status\n⚠️ 当前会话仍在等待网页权限授权，请先完成授权，或回复 `2` 切换新会话。';
  }
  return '## Status\n⏰ 超时未确认，本轮授权等待已取消。后续消息将按新输入处理。';
}

