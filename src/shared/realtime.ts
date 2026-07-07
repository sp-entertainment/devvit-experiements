// Shape of the messages broadcast over the realtime channel demo. Shared so
// the client's `connectRealtime<RealtimeCursorMessage>` call and the
// server's `realtime.send<RealtimeCursorMessage>` call stay in sync.
export type RealtimeCursorMessage = {
  userId: string;
  username: string;
  x: number;
  y: number;
  sentAt: number;
};
