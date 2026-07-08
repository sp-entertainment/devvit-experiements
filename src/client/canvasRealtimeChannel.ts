import { connectRealtime, context } from '@devvit/web/client';
import {
  canvasRealtimeChannel,
  type RealtimeCanvasMessage,
} from '../shared/realtime';

type CanvasMessageListener = (msg: RealtimeCanvasMessage) => void;
type StatusListener = (connected: boolean) => void;

const canvasListeners = new Set<CanvasMessageListener>();
const statusListeners = new Set<StatusListener>();
let started = false;
let connected = false;

export const canvasChannelName = () => canvasRealtimeChannel(context.postId);

const ensureConnected = () => {
  if (started) return;
  started = true;

  connectRealtime<RealtimeCanvasMessage>({
    channel: canvasChannelName(),
    onConnect: () => {
      connected = true;
      statusListeners.forEach((listener) => listener(connected));
    },
    onDisconnect: () => {
      connected = false;
      statusListeners.forEach((listener) => listener(connected));
    },
    onMessage: (msg) => canvasListeners.forEach((listener) => listener(msg)),
  });
};

export const onCanvasMessage = (
  listener: CanvasMessageListener
): (() => void) => {
  canvasListeners.add(listener);
  ensureConnected();
  return () => canvasListeners.delete(listener);
};

export const onCanvasConnectionChange = (
  listener: StatusListener
): (() => void) => {
  statusListeners.add(listener);
  ensureConnected();
  listener(connected);
  return () => statusListeners.delete(listener);
};
