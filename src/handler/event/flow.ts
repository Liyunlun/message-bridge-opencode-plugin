import type { OpencodeClient } from '@opencode-ai/sdk';
import type { AdapterMux } from '../mux';
import { bridgeLogger } from '../../logger';
import type { EventFlowDeps } from './types';
import {
  dispatchEventByType,
  flushAllEvents,
  resetEventDispatchState,
} from './dispatch';
import { summarizeObservedEvent, unwrapObservedEvent } from './utils';

export type { EventFlowDeps } from './types';

const FORWARDED_EVENT_TYPES = new Set<string>([
  'message.updated',
  'message.removed',
  'message.part.updated',
  'message.part.delta',
  'message.part.removed',
  'session.status',
  'session.idle',
  'session.error',
  'permission.updated',
  'permission.asked',
  'permission.replied',
  'question.asked',
  'question.replied',
  'question.rejected',
  'command.executed',
]);

function shouldForwardEventType(type: string): boolean {
  return FORWARDED_EVENT_TYPES.has(type);
}

export async function startGlobalEventListenerWithDeps(
  api: OpencodeClient,
  mux: AdapterMux,
  deps: EventFlowDeps
) {
  if (deps.listenerState.isListenerStarted) {
    bridgeLogger.debug('[BridgeFlowDebug] listener already started, skip');
    return;
  }
  deps.listenerState.isListenerStarted = true;
  deps.listenerState.shouldStopListener = false;

  bridgeLogger.info('[Listener] starting global event subscription (MUX)');

  let retryCount = 0;
  let globalRetryCount = 0;
  const connect = async () => {
    try {
      const events = await api.event.subscribe();
      bridgeLogger.info('[Listener] connected to OpenCode event stream');
      retryCount = 0;

      for await (const event of events.stream) {
        const e = unwrapObservedEvent(event);
        if (deps.listenerState.shouldStopListener) break;
        if (!e) {
          bridgeLogger.debug('[BridgeFlow] event.observed.unparsed', event);
          continue;
        }
        if (!shouldForwardEventType(e.type)) continue;
        bridgeLogger.info('[BridgeFlow] event.observed', summarizeObservedEvent(e));
        await dispatchEventByType(e, api, mux, deps);
      }

      await flushAllEvents(mux, deps);
    } catch (e) {
      if (deps.listenerState.shouldStopListener) return;

      bridgeLogger.error('[Listener] stream disconnected', e);
      await flushAllEvents(mux, deps);

      const delay = Math.min(5000 * (retryCount + 1), 60000);
      retryCount++;
      setTimeout(connect, delay);
    }
  };

  const connectGlobalPermissions = async () => {
    if (!api.global?.event) return;
    try {
      const events = await api.global.event();
      bridgeLogger.info('[Listener] connected to OpenCode global event stream');
      globalRetryCount = 0;

      for await (const event of events.stream) {
        const e = unwrapObservedEvent(event);
        if (deps.listenerState.shouldStopListener) break;
        if (!e) continue;
        if (!shouldForwardEventType(e.type)) continue;
        bridgeLogger.info('[BridgeFlow] global.event.observed', summarizeObservedEvent(e));
        await dispatchEventByType(e, api, mux, deps);
      }
    } catch (e) {
      if (deps.listenerState.shouldStopListener) return;
      bridgeLogger.error('[Listener] global stream disconnected', e);
      const delay = Math.min(5000 * (globalRetryCount + 1), 60000);
      globalRetryCount++;
      setTimeout(connectGlobalPermissions, delay);
    }
  };

  connect();
  connectGlobalPermissions();
}

export async function handleObservedEventWithDeps(
  event: unknown,
  api: OpencodeClient,
  mux: AdapterMux,
  deps: EventFlowDeps,
) {
  const e = unwrapObservedEvent(event);
  if (!e) {
    bridgeLogger.debug('[BridgeFlow] event.observed.unparsed', event);
    return;
  }
  if (!shouldForwardEventType(e.type)) return;
  bridgeLogger.info('[BridgeFlow] hook.event.observed', summarizeObservedEvent(e));
  await dispatchEventByType(e, api, mux, deps);
}

export function stopGlobalEventListenerWithDeps(deps: EventFlowDeps) {
  deps.listenerState.shouldStopListener = true;
  deps.listenerState.isListenerStarted = false;
  resetEventDispatchState(deps);
}
