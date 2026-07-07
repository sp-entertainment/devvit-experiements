import { connectRealtime, context } from '@devvit/web/client';
import type { RealtimeCursorMessage } from '../shared/realtime';

// `connectRealtime` only keeps ONE listener per channel name - a second call for the
// same channel silently reuses the first connection's callback. Since both the
// "Realtime" kitchen-sink tab and the Phaser rendering demo want to observe the same
// per-post channel, this module calls `connectRealtime` exactly once and fans the
// messages out to any number of local subscribers.

type MessageListener = (msg: RealtimeCursorMessage) => void;
type StatusListener = (connected: boolean) => void;

const messageListeners = new Set<MessageListener>();
const statusListeners = new Set<StatusListener>();
let started = false;

const ensureConnected = () => {
  if (started) return;
  started = true;

  connectRealtime<RealtimeCursorMessage>({
    channel: context.postId,
    onConnect: () => statusListeners.forEach((listener) => listener(true)),
    onDisconnect: () => statusListeners.forEach((listener) => listener(false)),
    onMessage: (msg) => messageListeners.forEach((listener) => listener(msg)),
  });
};

/** Subscribe to cursor broadcasts on this post's realtime channel. Returns an
 * unsubscribe function. */
export const onCursorMessage = (listener: MessageListener): (() => void) => {
  ensureConnected();
  messageListeners.add(listener);
  return () => messageListeners.delete(listener);
};

export const onCursorConnectionChange = (
  listener: StatusListener
): (() => void) => {
  ensureConnected();
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
};
