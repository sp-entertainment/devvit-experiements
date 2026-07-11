import { connectRealtime, context } from '@devvit/web/client';
import { traceClientLog } from './clientLogs';
import type {
  RealtimeBallMoveMessage,
  RealtimeCanvasMessage,
  RealtimeCursorMessage,
  RealtimeMessage,
} from '../shared/realtime';
import type { RealtimeTankGameMessage } from '../shared/tankGame';
import type { RealtimePongStateMessage } from '../shared/pong';

// `connectRealtime` only keeps ONE listener per channel name - a second call for the
// same channel silently reuses the first connection's callback. Since both the
// "Realtime" kitchen-sink tab and the Phaser rendering demo want to observe the same
// per-post channel, this module calls `connectRealtime` exactly once and fans the
// messages out to any number of local subscribers.

type CursorMessageListener = (msg: RealtimeCursorMessage) => void;
type BallMoveMessageListener = (msg: RealtimeBallMoveMessage) => void;
type CanvasMessageListener = (msg: RealtimeCanvasMessage) => void;
type TankGameMessageListener = (msg: RealtimeTankGameMessage) => void;
type PongGameMessageListener = (msg: RealtimePongStateMessage) => void;
type StatusListener = (connected: boolean) => void;

const cursorListeners = new Set<CursorMessageListener>();
const ballMoveListeners = new Set<BallMoveMessageListener>();
const canvasListeners = new Set<CanvasMessageListener>();
const tankGameListeners = new Set<TankGameMessageListener>();
const pongGameListeners = new Set<PongGameMessageListener>();
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
      } else if (msg.type === 'tankGameState') {
        tankGameListeners.forEach((listener) => listener(msg));
      } else if (msg.type === 'pongState') {
        pongGameListeners.forEach((listener) => listener(msg));
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

export const onTankGameMessage = (
  listener: TankGameMessageListener
): (() => void) => {
  ensureConnected();
  tankGameListeners.add(listener);
  return () => tankGameListeners.delete(listener);
};

export const onPongGameMessage = (
  listener: PongGameMessageListener
): (() => void) => {
  ensureConnected();
  pongGameListeners.add(listener);
  return () => pongGameListeners.delete(listener);
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
export const onTankGameConnectionChange = onCursorConnectionChange;
export const onPongGameConnectionChange = onCursorConnectionChange;
