import type { OpenCodeApi } from './opencode';
import type { FeishuClient } from './feishu';
import { LOADING_EMOJI } from './constants';
import type { Part } from '@opencode-ai/sdk';

// --- 类型定义 ---
interface SessionContext {
  chatId: string;
  senderId: string;
}

interface MessageBuffer {
  feishuMsgId: string | null;
  reasoning: string; // 专门存思考
  text: string; // 专门存正文
  lastUpdateTime: number;
}

// --- 全局状态 ---
const sessionToFeishuMap = new Map<string, SessionContext>();
// ⚠️ 改动 1: Key 改为 SessionID。我们确保每个 Session 同一时间只维护一条活动的飞书消息，这样能避免 reasoning 和 text 也是 ID 不同导致的分裂
const sessionBufferMap = new Map<string, MessageBuffer>();
const messageRoleMap = new Map<string, string>();

const UPDATE_INTERVAL = 500; // 稍微调快一点，飞书每秒2-5次问题不大
let isListenerStarted = false;
let shouldStopListener = false;

// --- 核心功能 1: 全局事件监听器 ---
export async function startGlobalEventListener(api: OpenCodeApi, feishu: FeishuClient) {
  if (isListenerStarted) return;
  isListenerStarted = true;
  shouldStopListener = false;

  console.log('[Listener] 🎧 Starting Global Event Subscription...');

  let retryCount = 0;

  const connect = async () => {
    try {
      const events = await api.event.subscribe();
      console.log('[Listener] ✅ Connected to OpenCode Event Stream');
      retryCount = 0;

      for await (const event of events.stream) {
        if (shouldStopListener) break;

        // 1. 记录消息角色 (防止回声)
        if (event.type === 'message.updated') {
          const info = event.properties.info;
          if (info && info.id && info.role) {
            messageRoleMap.set(info.id, info.role);
          }
          continue;
        }

        // 2. 监听内容流 (增量更新)
        if (event.type === 'message.part.updated') {
          const sessionId = event.properties.part.sessionID;
          const part = event.properties.part;
          const delta = (event.properties as any).delta;

          if (!sessionId || !part) continue;

          // 过滤掉用户消息
          const role = messageRoleMap.get(part.messageID);
          if (role === 'user') continue;

          const context = sessionToFeishuMap.get(sessionId);
          if (!context) continue;

          // 处理核心文本/思考
          if (part.type === 'text' || part.type === 'reasoning') {
            await handleStreamUpdate(feishu, context.chatId, sessionId, part, delta, false);
          }

          // 🔥 改动 2: 监听 step-finish，这是“防截断”的关键！
          // 当一个步骤结束时，强制刷新缓冲区，确保最后几个字发出去
          else if (part.type === 'step-finish') {
            console.log(`[Listener] [Session: ${sessionId}] Step Finished. Force flushing.`);
            await handleStreamUpdate(feishu, context.chatId, sessionId, part, undefined, true);
          }
        } else if (event.type === 'session.deleted' || event.type === 'session.error') {
          const sid = (event.properties as any).sessionID;
          if (sid) {
            sessionToFeishuMap.delete(sid);
            sessionBufferMap.delete(sid);
          }
        }
      }
    } catch (error) {
      if (shouldStopListener) return;
      console.error('[Listener] ❌ Stream Disconnected:', error);
      const delay = Math.min(5000 * (retryCount + 1), 60000);
      retryCount++;
      setTimeout(connect, delay);
    }
  };

  connect();
}

export function stopGlobalEventListener() {
  shouldStopListener = true;
  isListenerStarted = false;
  sessionToFeishuMap.clear();
  sessionBufferMap.clear();
  messageRoleMap.clear();
}

// 辅助函数：处理流式更新
async function handleStreamUpdate(
  feishu: FeishuClient,
  chatId: string,
  sessionId: string,
  part: Part,
  delta: string | undefined,
  forceFlush: boolean
) {
  // 获取 Buffer
  let buffer = sessionBufferMap.get(sessionId);
  if (!buffer) {
    buffer = {
      feishuMsgId: null,
      reasoning: '',
      text: '',
      lastUpdateTime: 0,
    };
    sessionBufferMap.set(sessionId, buffer);
  }

  // 🔥 修复点: 安全的类型判断 🔥
  if (typeof delta === 'string' && delta.length > 0) {
    // 1. Delta 模式 (增量)
    // 此时不需要访问 part.text，只用 delta
    if (part.type === 'reasoning') {
      buffer.reasoning += delta;
    } else if (part.type === 'text') {
      buffer.text += delta;
    }
  } else if (!delta) {
    // 2. Snapshot 模式 (快照/兜底)
    // ❌ 之前的错误写法: typeof part.text === 'string' (TS 报错，因为 step-finish 没有 text)
    // ✅ 现在的正确写法: 先判断 type，TS 就会知道它肯定有 text
    if (part.type === 'text' || part.type === 'reasoning') {
      if (part.type === 'reasoning') {
        if (part.text.length > buffer.reasoning.length) buffer.reasoning = part.text;
      } else {
        // 这里 TS 知道 part 是 TextPart，一定有 text
        if (part.text.length > buffer.text.length) buffer.text = part.text;
      }
    }
  }

  // 节流判断 (Throttling)
  const now = Date.now();
  const timeSinceLastUpdate = now - buffer.lastUpdateTime;

  const shouldUpdate = forceFlush || !buffer.feishuMsgId || timeSinceLastUpdate > UPDATE_INTERVAL;

  if (shouldUpdate) {
    const hasContent = buffer.reasoning.length > 0 || buffer.text.length > 0;
    if (!hasContent) return;

    buffer.lastUpdateTime = now;

    // 拼接 Markdown 内容
    let displayContent = '';

    // A. 思考部分
    if (buffer.reasoning) {
      const cleanReasoning = buffer.reasoning.trimEnd();
      const quoted = cleanReasoning
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n');
      displayContent += `> 🤔 **Thinking...**\n${quoted}\n\n`;
    }

    // B. 正文部分
    if (buffer.text) {
      displayContent += buffer.text;
    }

    if (!displayContent.trim()) return;

    try {
      if (!buffer.feishuMsgId) {
        const sentId = await feishu.sendMessage(chatId, displayContent);
        if (sentId) buffer.feishuMsgId = sentId;
      } else {
        await feishu.editMessage(chatId, buffer.feishuMsgId, displayContent);
      }
    } catch (e) {
      console.error(`[Listener] Failed to update Feishu msg:`, e);
    }
  }
}

// --- 核心功能 2: 极简消息处理器 ---
const sessionCache = new Map<string, string>();

export const createMessageHandler = (api: OpenCodeApi, feishu: FeishuClient) => {
  return async (chatId: string, text: string, messageId: string, senderId: string) => {
    console.log(`[Bridge] 📥 Incoming: "${text}" from Chat: ${chatId}`);

    if (text.trim().toLowerCase() === 'ping') {
      await feishu.sendMessage(chatId, 'Pong! ⚡️');
      return;
    }

    let reactionId: string | null = null;

    try {
      if (messageId) {
        reactionId = await feishu.addReaction(messageId, LOADING_EMOJI);
      }

      let sessionId = sessionCache.get(chatId);
      if (!sessionId) {
        const uniqueTitle = `Chat ${chatId.slice(-4)} [${new Date().toLocaleTimeString()}]`;
        const res = await api.createSession({ body: { title: uniqueTitle } });
        sessionId = res.data?.id;
        if (sessionId) sessionCache.set(chatId, sessionId);
      }

      if (!sessionId) throw new Error('Failed to init Session');

      sessionToFeishuMap.set(sessionId, { chatId, senderId });

      await api.promptSession({
        path: { id: sessionId },
        body: { parts: [{ type: 'text', text: text }] },
      });

      console.log(`[Bridge] [Session: ${sessionId}] 🚀 Prompt Sent.`);
    } catch (error: any) {
      console.error('[Bridge] ❌ Error:', error);
      if (error.status === 404) sessionCache.delete(chatId);
      await feishu.sendMessage(chatId, `❌ Error: ${error.message}`);
    } finally {
      if (messageId && reactionId) {
        await feishu.removeReaction(messageId, reactionId).catch(() => {});
      }
    }
  };
};
