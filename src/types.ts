// src/types.ts

export type BridgeMode = 'ws' | 'webhook';

export type IncomingMessageHandler = (
  chatId: string,
  text: string,
  messageId: string,
  senderId: string
) => Promise<void>;

export interface BridgeAdapter {
  start(onMessage: IncomingMessageHandler): Promise<void>;

  stop?(): Promise<void>;

  sendMessage(chatId: string, text: string): Promise<string | null>;

  editMessage(chatId: string, messageId: string, text: string): Promise<boolean>;

  addReaction?(messageId: string, emojiType: string): Promise<string | null>;

  removeReaction?(messageId: string, reactionId: string): Promise<void>;
}

export interface FeishuConfig {
  app_id: string;
  app_secret: string;
  mode: BridgeMode;
  port?: number;
  path?: string;
  encrypt_key?: string;
}
