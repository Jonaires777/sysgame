"""Adaptador Matrix (matrix-nio) do bot árbitro.

- MatrixNotifier: adaptador de SAÍDA, implementa a porta GameNotifier (state events, salas
  privadas com as mãos, avisos em texto).
- MatrixBot: adaptador de ENTRADA, traduz eventos do /sync (texto, eventos personalizados,
  saída de membros) em protocol.Move e chama o GameService.
"""
from __future__ import annotations

import asyncio
import logging
import time

from nio import (AsyncClient, AsyncClientConfig, InviteMemberEvent, JoinError, LoginResponse, MatrixRoom,
                 RoomCreateError, RoomMemberEvent, RoomMessageText, RoomPreset, RoomPutStateError,
                 RoomResolveAliasResponse, RoomVisibility, SyncResponse, UnknownEvent)

from .. import protocol as P
from ..application.service import GameService
from ..domain import cards as C
from ..domain.engine import Game
from .json_store import JsonStore

log = logging.getLogger("ultima.matrix")


def short(user: str | None) -> str:
    return user[1:].split(":", 1)[0] if user and user.startswith("@") else (user or "")


class MatrixNotifier:
    """Implementa application.ports.GameNotifier sobre o Matrix."""

    def __init__(self, client: AsyncClient, store: JsonStore, turn_timeout: float):
        self.client = client
        self.store = store
        self.turn_timeout = turn_timeout

    def power_levels(self) -> dict:
        # o criador (o bot) já tem nível máximo; nas salas v12 ele nem pode aparecer em "users".
        # Só o bot escreve o estado: jogadores não conseguem forjar a mesa.
        return {"events": {P.STATE: 100, P.LOBBY: 100, "m.room.power_levels": 100, "m.room.name": 100},
                "state_default": 100, "events_default": 0, "invite": 0}

    async def create_game_room(self, name: str, owner: str) -> str:
        resp = await self.client.room_create(
            name=name, topic="Digite !entrar para participar e !iniciar para começar. !ajuda mostra os comandos.",
            preset=RoomPreset.public_chat, invite=[owner], power_level_override=self.power_levels())
        if isinstance(resp, RoomCreateError):
            raise RuntimeError(f"não consegui criar a sala: {resp.message}")
        return resp.room_id

    async def publish_state(self, game: Game) -> None:
        state = game.public_state()
        # o Matrix só aceita inteiros nos eventos (float -> M_BAD_JSON)
        state["turn_timeout"] = int(self.turn_timeout) if self.turn_timeout > 0 else None
        state["turn_deadline"] = (int((game.turn_started_at + self.turn_timeout) * 1000)
                                  if game.status == "playing" and self.turn_timeout > 0 else None)
        resp = await self.client.room_put_state(game.game_id, P.STATE, state)
        if isinstance(resp, RoomPutStateError):
            log.error("estado da partida %s recusado pelo homeserver: %s", game.game_id, resp.message)

    async def publish_lobby(self, games: list[Game]) -> None:
        if not self.store.lobby_room:
            return
        open_games = [{"room_id": g.game_id, "name": g.name, "status": g.status, "owner": g.owner,
                       "players": g.players, "seq": g.seq}
                      for g in games if g.status != "finished" and g.players]
        await self.client.room_put_state(self.store.lobby_room, P.LOBBY, {"games": open_games[-30:]})

    async def send_result(self, room_id: str, event_id: str, sender: str, ok: bool,
                          seq: int | None, reason: str | None = None) -> None:
        content = {"in_reply_to": event_id, "sender": sender, "ok": ok, "seq": seq}
        if reason:
            content["reason"] = reason
        await self.client.room_send(room_id, P.RESULT, content)
        if not ok:
            await self.announce(room_id, f"⚠ {short(sender)}: {reason}")

    async def announce(self, room_id: str, text: str) -> None:
        await self.client.room_send(room_id, "m.room.message", {"msgtype": "m.notice", "body": text})

    async def show_table(self, game: Game, full: bool = False) -> None:
        await self.announce(game.game_id, table_text(game))

    async def send_hand(self, game: Game, user: str, as_text: bool = False) -> None:
        if user not in game.players:
            return
        room = await self._private_room(user)
        if not room:
            return
        hand = sorted(game.hands.get(user, []), key=lambda c: (c[0], c))
        playable = game.playable_cards(user)
        await self.client.room_put_state(room, P.HAND, {
            "game_id": game.game_id, "seq": game.seq, "cards": hand, "playable": playable,
            "status": game.status}, state_key=game.game_id)
        text = f"Suas cartas: {' '.join(hand) or '(nenhuma)'}"
        if playable:
            text += f"\nJogáveis agora: {' '.join(playable)}"
        elif user == game.current:
            text += "\nNenhuma jogável: !comprar" if not game.has_drawn else "\nNenhuma jogável: !passar"
        await self.announce(room, text)

    async def _private_room(self, user: str) -> str | None:
        room = self.store.dm_rooms.get(user)
        if room:
            return room
        resp = await self.client.room_create(
            name="Última Carta — suas cartas", is_direct=True, invite=[user], preset=RoomPreset.private_chat)
        if isinstance(resp, RoomCreateError):
            log.warning("não consegui criar sala privada para %s: %s", user, resp.message)
            return None
        self.store.dm_rooms[user] = resp.room_id
        self.store.save()
        return resp.room_id


def table_text(g: Game) -> str:
    last = g.log[-1] if g.log else ""
    if g.status == "lobby":
        return f"{last}\nJogadores: {', '.join(map(short, g.players))}. Digite !entrar para participar e !iniciar para começar."
    if g.status == "finished":
        return f"{last}\n🏆 {short(g.winner)} venceu! Use !criar no lobby para jogar de novo."
    counts = " · ".join(f"{short(p)}:{len(g.hands[p])}" for p in g.players)
    arrow = "→" if g.direction == 1 else "←"
    return (f"{last}\nMesa: {g.top} · cor {C.COLOR_NAMES[g.color]} · sentido {arrow}\n"
            f"Cartas: {counts}\nVez de {short(g.current)}")


class MatrixBot:
    """Adaptador de entrada: conecta no homeserver e entrega as jogadas ao GameService."""

    def __init__(self, client: AsyncClient, store: JsonStore, service: GameService, notifier: MatrixNotifier,
                 user: str, password: str, lobby_alias: str):
        self.client = client
        self.store = store
        self.service = service
        self.notifier = notifier
        self.user = user
        self.password = password
        self.lobby_alias = lobby_alias

    async def login(self) -> None:
        while True:
            try:
                resp = await self.client.login(self.password, device_name="ultima-bot")
                if isinstance(resp, LoginResponse):
                    break
                log.info("login falhou (%s); tentando registrar a conta do bot", resp.message)
                reg = await self.client.register(self.user, self.password, device_name="ultima-bot")
                if getattr(reg, "access_token", None):
                    break
                log.warning("registro falhou: %s", reg)
            except Exception as e:  # homeserver ainda subindo
                log.info("homeserver indisponível (%s); nova tentativa em 3 s", e)
            await asyncio.sleep(3)
        log.info("logado como %s", self.client.user_id)

    async def ensure_lobby(self) -> None:
        server = self.client.user_id.split(":", 1)[1]
        alias = f"#{self.lobby_alias}:{server}"
        resp = await self.client.room_resolve_alias(alias)
        if isinstance(resp, RoomResolveAliasResponse):
            room_id = resp.room_id
            await self.client.join(room_id)
        else:
            created = await self.client.room_create(
                visibility=RoomVisibility.public, alias=self.lobby_alias, name="Última Carta — Lobby",
                topic="Digite !criar para abrir uma partida, ou !ajuda para ver os comandos.",
                preset=RoomPreset.public_chat, power_level_override=self.notifier.power_levels())
            if isinstance(created, RoomCreateError):
                raise RuntimeError(f"não consegui criar o lobby: {created}")
            room_id = created.room_id
        self.store.lobby_room = room_id
        self.store.save()
        await self.notifier.publish_lobby(self.store.all())
        log.info("lobby: %s (%s)", alias, room_id)

    async def run(self) -> None:
        await self.login()
        if self.store.next_batch:
            # retoma de onde parou: as jogadas enviadas com o bot fora estão guardadas no homeserver
            self.client.next_batch = self.store.next_batch
            log.info("retomando a partir do sync token salvo")
        else:
            first = await self.client.sync(timeout=0, full_state=True)  # primeira vez: ignora o histórico
            if isinstance(first, SyncResponse):
                self.store.next_batch = first.next_batch
        for g in self.service.restart_turn_clocks():
            await self.notifier.publish_state(g)  # o prazo da vez mudou: avisa os clientes
        await self.ensure_lobby()
        self.client.add_event_callback(self.on_invite, InviteMemberEvent)
        self.client.add_event_callback(self.on_text, RoomMessageText)
        self.client.add_event_callback(self.on_custom, UnknownEvent)
        self.client.add_event_callback(self.on_member, RoomMemberEvent)
        self.client.add_response_callback(self.on_sync, SyncResponse)
        asyncio.create_task(self.timeout_loop())
        await self.client.sync_forever(timeout=30000, full_state=False)

    async def on_sync(self, resp: SyncResponse) -> None:
        # o token só é gravado depois de processar o lote inteiro: entrega "pelo menos uma vez",
        # e a deduplicação por event_id no serviço evita aplicar duas vezes
        self.store.next_batch = resp.next_batch
        self.store.save()

    async def on_invite(self, room: MatrixRoom, event: InviteMemberEvent) -> None:
        if event.state_key == self.client.user_id and event.membership == "invite":
            r = await self.client.join(room.room_id)
            if not isinstance(r, JoinError):
                await self.notifier.announce(room.room_id, "Olá! Digite !criar para abrir uma partida.\n" + P.HELP)

    async def on_text(self, room: MatrixRoom, event: RoomMessageText) -> None:
        move = P.parse_text(event.body)
        if move:
            await self._deliver(room.room_id, event.sender, event.event_id, move)

    async def on_custom(self, room: MatrixRoom, event: UnknownEvent) -> None:
        if event.type == P.MOVE:
            move = P.parse_event(event.source.get("content", {}))
            if move:
                await self._deliver(room.room_id, event.sender, event.event_id, move)

    async def on_member(self, room: MatrixRoom, event: RoomMemberEvent) -> None:
        g = self.store.get(room.room_id)
        if g and event.membership in ("leave", "ban") and event.state_key in g.players:
            await self._deliver(room.room_id, event.state_key, event.event_id, P.Move("sair"))

    async def _deliver(self, room_id: str, sender: str, event_id: str, move: P.Move) -> None:
        if sender == self.client.user_id:
            return
        try:
            await self.service.handle(room_id, sender, event_id, move)
        except Exception:
            log.exception("erro processando %s de %s", move.action, sender)

    async def timeout_loop(self) -> None:
        while True:
            await asyncio.sleep(2)
            try:
                await self.service.check_timeouts(time.time())
            except Exception:
                log.exception("falha verificando timeouts")


def build_client(homeserver: str, user: str) -> AsyncClient:
    return AsyncClient(homeserver, user, config=AsyncClientConfig(store_sync_tokens=False))
