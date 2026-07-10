import { connectRealtime, context } from '@devvit/web/client';
import { traceClientLog } from './clientLogs';
import type {
  RealtimeBallMoveMessage,
  RealtimeCanvasMessage,
  RealtimeCursorMessage,
  RealtimeMessage,
} from '../shared/realtime';

// `connectRealtime` only keeps ONE listener per channel name - a second call for the
// same channel silently reuses the first connection's callback. Since both the
// "Realtime" kitchen-sink tab and the Phaser rendering demo want to observe the same
// per-post channel, this module calls `connectRealtime` exactly once and fans the
// messages out to any number of local subscribers.

type CursorMessageListener = (msg: RealtimeCursorMessage) => void;
type BallMoveMessageListener = (msg: RealtimeBallMoveMessage) => void;
type CanvasMessageListener = (msg: RealtimeCanvasMessage) => void;
type StatusListener = (connected: boolean) => void;

const cursorListeners = new Set<CursorMessageListener>();
const ballMoveListeners = new Set<BallMoveMessageListener>();
const canvasListeners = new Set<CanvasMessageListener>();
const statusListeners = new Set<StatusListener>();
let started = false;
let connected = false;

const ensureConnected = () => {
  if (started) return;
  started = true;
  traceClientLog('Connecting to realtime channel:', context.postId);

  connectRealtime<RealtimeMessage>({
    channel: context.postId,
    onConnect: () => {
      connected = true;
      console.info('Connected to realtime channel:', context.postId);
      statusListeners.forEach((listener) => listener(connected));
    },
    onDisconnect: () => {
      connected = false;
      console.info('Disconnected from realtime channel:', context.postId);
      statusListeners.forEach((listener) => listener(connected));
    },
    onMessage: (msg) => {
      if (msg.type === 'cursor') {
        cursorListeners.forEach((listener) => listener(msg));
      } else if (msg.type === 'ballMove') {
        ballMoveListeners.forEach((listener) => listener(msg));
      } else {
        canvasListeners.forEach((listener) => listener(msg));
      }
    },
  });
};

/** Subscribe to cursor broadcasts on this post's realtime channel. Returns an
 * unsubscribe function. */
export const onCursorMessage = (
  listener: CursorMessageListener
): (() => void) => {
  ensureConnected();
  cursorListeners.add(listener);
  return () => cursorListeners.delete(listener);
};

export const onBallMoveMessage = (
  listener: BallMoveMessageListener
): (() => void) => {
  ensureConnected();
  ballMoveListeners.add(listener);
  return () => ballMoveListeners.delete(listener);
};

export const onCanvasMessage = (
  listener: CanvasMessageListener
): (() => void) => {
  ensureConnected();
  canvasListeners.add(listener);
  return () => canvasListeners.delete(listener);
};

export const onCursorConnectionChange = (
  listener: StatusListener
): (() => void) => {
  ensureConnected();
  statusListeners.add(listener);
  listener(connected);
  return () => statusListeners.delete(listener);
};

export const onCanvasConnectionChange = onCursorConnectionChange;
