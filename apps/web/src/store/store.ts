// Store da aplicação: estado fora do React, alimentado pelo /sync do Matrix.
// A UI assina com useStore() (useSyncExternalStore). O bot árbitro é a única fonte de verdade:
// estado, mão e lobby só são aceitos quando enviados por ele.
import { useSyncExternalStore } from "react";
import { MatrixClient, MatrixError, type MatrixEvent, type Session, type SyncResponse } from "../infra/matrix/client";
import { EV, STATE_TYPES, type ColorCode, type GameState, type Hand, type LobbyGame, type MoveAction, type MoveExtra, type MoveResult } from "../domain/protocol";
import { load, save } from "./storage";

export interface ChatMessage {
  id: string;
  sender: string;
  body: string;
  notice: boolean;
}

export interface RoomData {
  name: string;
  state: Record<string, unknown>; // `${type}|${state_key}` -> content
  messages: ChatMessage[];
}

export type View = "login" | "lobby" | "game";

export interface Toast {
  id: number;
  text: string;
  kind: "error" | "info";
}

export interface AppState {
  homeserver: string;
  session: Session | null;
  rooms: Record<string, RoomData>;
  lobbyId: string | null;
  lobbyStatus: string;
  view: View;
  gameId: string | null;
  lastCardArmed: boolean;
  pendingCreate: boolean;
  toast: Toast | null;
}

const params = new URLSearchParams(location.search);
const FILTER = JSON.stringify({ room: { timeline: { limit: 40 } }, presence: { types: [] } });

const initialSession = load<Session>("session");
let state: AppState = {
  homeserver: load<string>("hs") || params.get("hs") || `${location.protocol}//${location.hostname}:8008`,
  session: initialSession,
  rooms: {},
  lobbyId: null,
  lobbyStatus: "",
  view: initialSession ? "lobby" : "login",
  gameId: null,
  lastCardArmed: false,
  pendingCreate: false,
  toast: null,
};

const client = new MatrixClient(state.homeserver, state.session);
const listeners = new Set<() => void>();
let since: string | null = null;
let syncAbort: AbortController | null = null;
let toastSeq = 0;

function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useStore(): AppState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}

// ------------------------------------------------------------------ seletores
export const me = (s: AppState = state) => s.session?.user_id ?? null;
export const serverName = (s: AppState = state) => me(s)?.split(":").slice(1).join(":") ?? "";
export const botId = (s: AppState = state) => params.get("bot") || `@ultima:${serverName(s)}`;

export const selectGame = (s: AppState, roomId: string | null): GameState | null =>
  (roomId && (s.rooms[roomId]?.state[`${EV.STATE}|`] as GameState)) || null;

export const selectLobby = (s: AppState): LobbyGame[] =>
  ((s.lobbyId && (s.rooms[s.lobbyId]?.state[`${EV.LOBBY}|`] as { games?: LobbyGame[] })) || {}).games ?? [];

export function selectHand(s: AppState, gameId: string | null): Hand | null {
  if (!gameId) return null;
  for (const r of Object.values(s.rooms)) {
    const h = r.state[`${EV.HAND}|${gameId}`] as Hand | undefined;
    if (h) return h;
  }
  return null;
}

// ------------------------------------------------------------------ sync
function applyEvent(rooms: Record<string, RoomData>, roomId: string, ev: MatrixEvent, live: boolean) {
  const room = (rooms[roomId] ??= { name: "", state: {}, messages: [] });
  const fromBot = ev.sender === botId();
  if (ev.type === "m.room.name") room.name = ev.content.name ?? "";

  if (ev.state_key !== undefined && STATE_TYPES.includes(ev.type)) {
    if (!fromBot) return; // segurança: ignora estado forjado por qualquer outro usuário
    room.state = { ...room.state, [`${ev.type}|${ev.state_key}`]: ev.content };
    const gs = ev.content as GameState;
    if (ev.type === EV.STATE && state.pendingCreate && gs.owner === me() && gs.status === "lobby") {
      pendingOpen = roomId;
    }
    return;
  }
  if (ev.type === "m.room.message") {
    const msg: ChatMessage = {
      id: ev.event_id ?? `${Date.now()}-${Math.random()}`,
      sender: ev.sender,
      body: String(ev.content.body ?? ""),
      notice: ev.content.msgtype === "m.notice",
    };
    room.messages = [...room.messages, msg].slice(-200);
  }
  if (ev.type === EV.RESULT && fromBot && live) {
    const r = ev.content as MoveResult;
    if (r.sender === me() && !r.ok && r.reason) toast(r.reason);
  }
}

let pendingOpen: string | null = null;

function processSync(data: SyncResponse, live: boolean) {
  const rooms = { ...state.rooms };
  const joined = data.rooms?.join ?? {};
  for (const [rid, r] of Object.entries(joined)) {
    rooms[rid] = rooms[rid] ? { ...rooms[rid] } : { name: "", state: {}, messages: [] };
    for (const ev of r.state?.events ?? []) applyEvent(rooms, rid, ev, false);
    for (const ev of r.timeline?.events ?? []) applyEvent(rooms, rid, ev, live);
  }
  // convites do bot (sala da partida e sala privada das cartas) são aceitos automaticamente
  for (const [rid, r] of Object.entries(data.rooms?.invite ?? {})) {
    const inv = (r.invite_state?.events ?? []).find((e) => e.type === "m.room.member" && e.state_key === me());
    if (inv?.sender === botId()) client.join(rid).catch(() => {});
  }
  for (const rid of Object.keys(data.rooms?.leave ?? {})) delete rooms[rid];

  const patch: Partial<AppState> = { rooms };
  if (pendingOpen) {
    Object.assign(patch, { pendingCreate: false, view: "game", gameId: pendingOpen });
    pendingOpen = null;
  }
  set(patch);
}

async function syncLoop(abort: AbortController) {
  while (!abort.signal.aborted && state.session) {
    try {
      const data = await client.sync(since, FILTER, abort.signal);
      const live = since != null;
      since = data.next_batch;
      processSync(data, live);
    } catch (e) {
      if (abort.signal.aborted) return;
      if (e instanceof MatrixError && e.status === 401) return logout("Sessão expirada, entre de novo.");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function enterLobby(abort: AbortController) {
  const alias = `#ultima:${serverName()}`;
  while (!abort.signal.aborted) {
    try {
      const r = await client.join(alias);
      set({ lobbyId: r.room_id, lobbyStatus: "" });
      return;
    } catch (e) {
      set({ lobbyStatus: `Aguardando o bot criar o lobby ${alias}… (${(e as Error).message})` });
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

function start() {
  syncAbort?.abort();
  const abort = (syncAbort = new AbortController());
  since = null;
  set({ view: "lobby" });
  void syncLoop(abort);
  void enterLobby(abort);
}

// ------------------------------------------------------------------ ações
export function toast(text: string, kind: Toast["kind"] = "error") {
  const id = ++toastSeq;
  set({ toast: { id, text, kind } });
  setTimeout(() => state.toast?.id === id && set({ toast: null }), 3500);
}

export async function authenticate(mode: "login" | "register", user: string, password: string, homeserver: string) {
  client.homeserver = homeserver.trim().replace(/\/$/, "");
  client.session = null;
  const session = mode === "register" ? await client.register(user, password) : await client.login(user, password);
  client.session = { user_id: session.user_id, access_token: session.access_token };
  save("session", client.session);
  save("hs", client.homeserver);
  set({ session: client.session, homeserver: client.homeserver });
  start();
}

export function logout(message?: string) {
  syncAbort?.abort();
  syncAbort = null;
  save("session", null);
  client.session = null;
  since = null;
  set({ session: null, rooms: {}, lobbyId: null, view: "login", gameId: null, lastCardArmed: false });
  if (message) toast(message);
}

export async function move(action: MoveAction, extra: MoveExtra = {}) {
  const gameId = state.gameId;
  if (!gameId) return;
  const gs = selectGame(state, gameId);
  try {
    await client.send(gameId, EV.MOVE, { action, game_id: gameId, seq: gs?.seq ?? null, ...extra });
  } catch (e) {
    toast(`Falha ao enviar: ${(e as Error).message}`);
  }
}

export async function playCard(card: string, color: ColorCode | null, handSize: number) {
  const last = handSize === 2 && state.lastCardArmed;
  set({ lastCardArmed: false });
  await move("play", { card, color, last_card: last });
}

export function setLastCardArmed(armed: boolean) {
  if (state.lastCardArmed !== armed) set({ lastCardArmed: armed });
}

export function newGame() {
  if (!state.lobbyId) return;
  set({ pendingCreate: true });
  client.send(state.lobbyId, EV.MOVE, { action: "create" }).catch((e) => toast((e as Error).message));
  toast("Criando partida…", "info");
}

export async function openGame(roomId: string) {
  set({ gameId: roomId, view: "game", lastCardArmed: false });
  if (!state.rooms[roomId]) {
    try {
      await client.join(roomId);
    } catch (e) {
      toast(`Não consegui entrar na sala: ${(e as Error).message}`);
    }
  }
}

export function backToLobby() {
  set({ view: "lobby", lastCardArmed: false });
}

export function sendChat(body: string) {
  if (!state.gameId || !body.trim()) return;
  client.send(state.gameId, "m.room.message", { msgtype: "m.text", body: body.trim() }).catch((e) => toast((e as Error).message));
}

if (state.session) start();
