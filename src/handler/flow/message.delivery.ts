import type { BridgeAdapter } from '../../types';
import { simpleHash } from '../../bridge/buffer';
import type { MessageBuffer } from '../../bridge/buffer';
import { sleep } from '../../utils';
import { bridgeLogger } from '../../logger';

type SessionContext = { chatId: string; senderId: string };
const inFlightEdits = new Set<string>();

function getEditRetryDelay(adapter: BridgeAdapter): number {
  const provider = (adapter as { provider?: string }).provider;
  if (provider === 'telegram') return 60;
  return 500;
}

function getEditMinInterval(adapter: BridgeAdapter): number {
  const provider = (adapter as { provider?: string }).provider;
  if (provider === 'feishu' || provider === 'lark') return 2500;
  if (provider === 'telegram') return 120;
  return 500;
}

function shouldFallbackToNewMessageOnEditFailure(adapter: BridgeAdapter): boolean {
  const provider = (adapter as { provider?: string }).provider;
  // Feishu/Lark has strict per-message update rate limits.
  // Falling back to sendMessage on edit failure floods new messages.
  if (provider === 'feishu' || provider === 'lark') return false;
  return true;
}

export async function safeEditWithRetry(
  adapter: BridgeAdapter,
  chatId: string,
  platformMsgId: string,
  content: string,
): Promise<string | null> {
  let ok = false;
  try {
    ok = await adapter.editMessage(chatId, platformMsgId, content);
  } catch (e) {
    bridgeLogger.warn(
      `[BridgeFlowDebug] edit threw first try chat=${chatId} msg=${platformMsgId} contentLen=${content.length}`,
      e,
    );
  }
  if (ok) return platformMsgId;
  bridgeLogger.warn(
    `[BridgeFlowDebug] edit failed first try chat=${chatId} msg=${platformMsgId} contentLen=${content.length}`,
  );
  await sleep(getEditRetryDelay(adapter));
  let retryOk = false;
  try {
    retryOk = await adapter.editMessage(chatId, platformMsgId, content);
  } catch (e) {
    bridgeLogger.warn(
      `[BridgeFlowDebug] edit threw retry chat=${chatId} msg=${platformMsgId} contentLen=${content.length}`,
      e,
    );
  }
  if (retryOk) return platformMsgId;
  bridgeLogger.warn(
    `[BridgeFlowDebug] edit failed retry chat=${chatId} msg=${platformMsgId} fallback=sendMessage contentLen=${content.length}`,
  );

  if (!shouldFallbackToNewMessageOnEditFailure(adapter)) {
    bridgeLogger.warn(
      `[BridgeFlowDebug] edit fallback disabled chat=${chatId} msg=${platformMsgId} provider=feishu`,
    );
    return null;
  }

  // Fallback for platforms that don't support edit semantics well.
  const sent = await adapter.sendMessage(chatId, content);
  if (sent) {
    bridgeLogger.info(
      `[BridgeFlowDebug] fallback sendMessage created new msg chat=${chatId} prevMsg=${platformMsgId} newMsg=${sent}`,
    );
  }
  return sent || null;
}

export async function flushMessage(params: {
  adapter: BridgeAdapter;
  chatId: string;
  messageId: string;
  msgBuffers: Map<string, MessageBuffer>;
  buildDisplay: (buffer: MessageBuffer) => string;
  force?: boolean;
}) {
  const { adapter, chatId, messageId, msgBuffers, buildDisplay, force = false } = params;
  const buffer = msgBuffers.get(messageId);
  if (!buffer?.platformMsgId) return;

  const content = buildDisplay(buffer);
  if (!content.trim()) return;

  const provider = (adapter as { provider?: string }).provider;
  if ((provider === 'feishu' || provider === 'lark') && !force) {
    return;
  }

  const hash = simpleHash(content);
  if (hash === buffer.lastDisplayHash) return;

  const now = Date.now();
  const minInterval = getEditMinInterval(adapter);
  if (buffer.lastUpdateTime > 0 && now - buffer.lastUpdateTime < minInterval) {
    bridgeLogger.debug(
      `[BridgeFlowDebug] skip-edit-throttle chat=${chatId} msg=${buffer.platformMsgId} waitMs=${
        minInterval - (now - buffer.lastUpdateTime)
      } force=${force}`,
    );
    return;
  }

  const editKey = `${chatId}:${buffer.platformMsgId}`;
  if (inFlightEdits.has(editKey)) {
    bridgeLogger.debug(
      `[BridgeFlowDebug] skip-edit-inflight chat=${chatId} msg=${buffer.platformMsgId}`,
    );
    return;
  }

  // Count every edit attempt for throttling, even if provider rejects it.
  buffer.lastUpdateTime = now;
  inFlightEdits.add(editKey);

  try {
    const msgId = await safeEditWithRetry(adapter, chatId, buffer.platformMsgId, content).catch(
      () => null,
    );
    if (msgId) {
      buffer.platformMsgId = msgId;
      buffer.lastDisplayHash = hash;
      buffer.lastUpdateTime = Date.now();
    }
  } finally {
    inFlightEdits.delete(editKey);
  }
}

export async function flushAll(params: {
  mux: { get(key: string): BridgeAdapter | undefined };
  sessionActiveMsg: Map<string, string>;
  sessionToCtx: Map<string, SessionContext>;
  sessionToAdapterKey: Map<string, string>;
  msgBuffers: Map<string, MessageBuffer>;
  buildDisplay: (buffer: MessageBuffer) => string;
}) {
  const { mux, sessionActiveMsg, sessionToCtx, sessionToAdapterKey, msgBuffers, buildDisplay } =
    params;
  for (const [sid, mid] of sessionActiveMsg.entries()) {
    const ctx = sessionToCtx.get(sid);
    const adapterKey = sessionToAdapterKey.get(sid);
    if (!ctx || !mid || !adapterKey) continue;

    const adapter = mux.get(adapterKey);
    if (!adapter) continue;

    await flushMessage({
      adapter,
      chatId: ctx.chatId,
      messageId: mid,
      msgBuffers,
      buildDisplay,
      force: true,
    });
  }
}
