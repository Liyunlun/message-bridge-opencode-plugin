import type { Event } from '@opencode-ai/sdk';

export type EventWithType = { type: Event['type'] | string; properties?: unknown };

export const KNOWN_EVENT_TYPES = new Set<string>([
  'server.instance.disposed',
  'installation.updated',
  'installation.update-available',
  'lsp.client.diagnostics',
  'lsp.updated',
  'message.updated',
  'message.removed',
  'message.part.updated',
  'message.part.delta',
  'message.part.removed',
  'permission.updated',
  'permission.replied',
  'session.status',
  'session.idle',
  'session.compacted',
  'file.edited',
  'todo.updated',
  'command.executed',
  'session.created',
  'session.updated',
  'session.deleted',
  'session.diff',
  'session.error',
  'file.watcher.updated',
  'vcs.branch.updated',
  'tui.prompt.append',
  'tui.command.execute',
  'tui.toast.show',
  'pty.created',
  'pty.updated',
  'pty.exited',
  'pty.deleted',
  'server.connected',
  'server.heartbeat',
  // v2/compat
  'permission.asked',
  'question.asked',
  'question.replied',
  'question.rejected',
]);

export const KNOWN_PART_TYPES = new Set<string>([
  'text',
  'subtask',
  'reasoning',
  'file',
  'tool',
  'step-start',
  'step-finish',
  'snapshot',
  'patch',
  'agent',
  'retry',
  'compaction',
]);

export function readStringField(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

export function unwrapObservedEvent(event: unknown): EventWithType | null {
  const direct = event as
    | {
        type?: unknown;
        event?: unknown;
        properties?: unknown;
        payload?: unknown;
        data?: unknown;
      }
    | null;
  if (!direct || typeof direct !== 'object') return null;

  if (typeof direct.type === 'string') {
    return direct as EventWithType;
  }

  const fromPayload = direct.payload as
    | { type?: unknown; properties?: unknown; payload?: unknown; data?: unknown }
    | null;
  if (fromPayload && typeof fromPayload.type === 'string') {
    return fromPayload as EventWithType;
  }

  const fromData = direct.data as
    | { type?: unknown; properties?: unknown; payload?: unknown; data?: unknown }
    | null;
  if (fromData && typeof fromData.type === 'string') {
    return fromData as EventWithType;
  }

  const eventName = typeof direct.event === 'string' ? direct.event : undefined;
  if (eventName) {
    if (direct.data && typeof direct.data === 'object') {
      const dataObj = direct.data as Record<string, unknown>;
      if (typeof dataObj.type === 'string') {
        return dataObj as EventWithType;
      }
      const dataProps =
        dataObj.properties && typeof dataObj.properties === 'object' ? dataObj.properties : dataObj;
      return { type: eventName, properties: dataProps };
    }

    if (direct.payload && typeof direct.payload === 'object') {
      const payloadObj = direct.payload as Record<string, unknown>;
      if (typeof payloadObj.type === 'string') {
        return payloadObj as EventWithType;
      }
      const payloadProps =
        payloadObj.properties && typeof payloadObj.properties === 'object'
          ? payloadObj.properties
          : payloadObj;
      return { type: eventName, properties: payloadProps };
    }

    if (direct.properties && typeof direct.properties === 'object') {
      return { type: eventName, properties: direct.properties };
    }
  }

  return null;
}

export function summarizeObservedEvent(event: unknown): Record<string, unknown> {
  const e = event as { type?: string; properties?: unknown };
  const props = (e?.properties ?? {}) as Record<string, unknown>;
  const info =
    props.info && typeof props.info === 'object'
      ? (props.info as Record<string, unknown>)
      : undefined;
  const part =
    props.part && typeof props.part === 'object'
      ? (props.part as Record<string, unknown>)
      : undefined;
  const eventName = (event as { event?: unknown })?.event;

  return {
    type:
      typeof e?.type === 'string'
        ? e.type
        : typeof eventName === 'string'
          ? eventName
          : 'unknown',
    session_id:
      readStringField(props, 'sessionID') ??
      readStringField(info ?? {}, 'sessionID') ??
      readStringField(part ?? {}, 'sessionID'),
    message_id:
      readStringField(info ?? {}, 'id') ??
      readStringField(props, 'messageID') ??
      readStringField(part ?? {}, 'messageID'),
    role: readStringField(info ?? {}, 'role'),
    part_type: readStringField(part ?? {}, 'type') ?? readStringField(props, 'field'),
    part_id: readStringField(part ?? {}, 'id') ?? readStringField(props, 'partID'),
    has_delta: typeof props.delta === 'string' && props.delta.length > 0,
    has_part_metadata:
      !!part &&
      typeof (part as { metadata?: unknown }).metadata === 'object' &&
      (part as { metadata?: unknown }).metadata !== null,
  };
}
