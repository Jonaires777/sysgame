// Contrato com o bot árbitro (ver docs do servidor: ultima/protocol.py).

const NS = "br.ufc.sysgame";
export const EV = {
  MOVE: `${NS}.move`,
  STATE: `${NS}.state`,
  HAND: `${NS}.hand`,
  RESULT: `${NS}.result`,
  LOBBY: `${NS}.lobby`,
} as const;

export const STATE_TYPES: readonly string[] = [EV.STATE, EV.HAND, EV.LOBBY];

export type GameStatus = "lobby" | "playing" | "finished";

/** Estado público da partida (state event br.ufc.sysgame.state, só o bot escreve). */
export interface GameState {
  game_id: string;
  owner: string;
  name?: string;
  status: GameStatus;
  seq: number;
  players: string[];
  hand_counts: Record<string, number>;
  top_card: string | null;
  color: ColorCode | null;
  current: string | null;
  direction: 1 | -1;
  has_drawn: boolean;
  draw_pile: number;
  winner: string | null;
  log: string[];
  turn_timeout?: number | null;
  turn_deadline?: number | null;
}

/** Mão do jogador (state event br.ufc.sysgame.hand na sala privada bot↔jogador). */
export interface Hand {
  game_id: string;
  seq: number;
  cards: string[];
  playable: string[];
  status: GameStatus;
}

export interface LobbyGame {
  room_id: string;
  name: string;
  status: GameStatus;
  owner: string;
  players: string[];
  seq: number;
}

export interface MoveResult {
  in_reply_to: string;
  sender: string;
  ok: boolean;
  reason?: string;
  seq: number | null;
}

export type MoveAction = "create" | "join" | "leave" | "start" | "play" | "draw" | "pass";

export interface MoveExtra {
  card?: string;
  color?: ColorCode | null;
  last_card?: boolean;
}

export type ColorCode = "F" | "A" | "T" | "V";

export const short = (userId: string | null | undefined) => (userId || "").replace(/^@/, "").split(":")[0];
