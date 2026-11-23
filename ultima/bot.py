"""Bot árbitro do Última Carta.

É a única autoridade do jogo (sequenciador): guarda baralho e mãos, valida cada jogada na
ordem em que ela aparece na timeline do seu homeserver e publica o estado resultante.

  python -m ultima.bot          (configuração por variáveis de ambiente, ver README)
"""
from __future__ import annotations

import asyncio
import logging
import os
import time

from nio import (AsyncClient, AsyncClientConfig, InviteMemberEvent, JoinError, LoginResponse, MatrixRoom,
                 RoomCreateError, RoomMemberEvent, RoomMessageText, RoomPreset, RoomResolveAliasResponse,
                 RoomVisibility, SyncResponse, UnknownEvent)

from . import cards as C
from . import protocol as P
from .engine import Game, GameError
from .store import Store

log = logging.getLogger("ultima.bot")

HOMESERVER = os.environ.get("HOMESERVER", "http://localhost:8008")
BOT_USER = os.environ.get("BOT_USER", "ultima")
BOT_PASSWORD = os.environ.get("BOT_PASSWORD", "ultima-bot-senha")
DATA_DIR = os.environ.get("DATA_DIR", "data")
LOBBY_ALIAS = os.environ.get("LOBBY_ALIAS", "ultima")
TURN_TIMEOUT = float(os.environ.get("TURN_TIMEOUT", "90"))  # segundos; 0 desliga
MAX_TIMEOUTS = int(os.environ.get("MAX_TIMEOUTS", "3"))      # timeouts seguidos até remover o jogador


def short(user: str) -> str:
    return user[1:].split(":", 1)[0] if user.startswith("@") else user


class Bot:
    def __init__(self) -> None:
        self.client = AsyncClient(HOMESERVER, BOT_USER, config=AsyncClientConfig(store_sync_tokens=False))
        self.store = Store(os.path.join(DATA_DIR, "bot-state.json")).load()
        self.lock = asyncio.Lock()

    # ------------------------------------------------------------ inicialização
    async def login(self) -> None:
        while True:
            try:
                resp = await self.client.login(BOT_PASSWORD, device_name="ultima-bot")
                if isinstance(resp, LoginResponse):
                    break
                log.info("login falhou (%s); tentando registrar a conta do bot", resp.message)
                reg = await self.client.register(BOT_USER, BOT_PASSWORD, device_name="ultima-bot")
                if getattr(reg, "access_token", None):
                    break
                log.warning("registro falhou: %s", reg)
            except Exception as e:  # homeserver ainda subindo
                log.info("homeserver indisponível (%s); nova tentativa em 3 s", e)
            await asyncio.sleep(3)
        log.info("logado como %s", self.client.user_id)

    @property
    def server_name(self) -> str:
        return self.client.user_id.split(":", 1)[1]

    async def ensure_lobby(self) -> None:
        alias = f"#{LOBBY_ALIAS}:{self.server_name}"
        resp = await self.client.room_resolve_alias(alias)
        if isinstance(resp, RoomResolveAliasResponse):
            room_id = resp.room_id
            await self.client.join(room_id)
        else:
            created = await self.client.room_create(
                visibility=RoomVisibility.public, alias=LOBBY_ALIAS, name="Última Carta — Lobby",
                topic="Digite !criar para abrir uma partida, ou !ajuda para ver os comandos.",
                preset=RoomPreset.public_chat, power_level_override=self._power_levels())
            if isinstance(created, RoomCreateError):
                raise RuntimeError(f"não consegui criar o lobby: {created}")
            room_id = created.room_id
        self.store.lobby_room = room_id
        self.store.save()
        await self.publish_lobby()
        log.info("lobby: %s (%s)", alias, room_id)

    def _power_levels(self) -> dict:
        # o criador da sala (o bot) já recebe o nível máximo; nas versões de sala novas (v12) ele
        # nem pode aparecer em "users"
        return {"events": {P.STATE: 100, P.LOBBY: 100, "m.room.power_levels": 100, "m.room.name": 100},
                "state_default": 100, "events_default": 0, "invite": 0}

    async def run(self) -> None:
        await self.login()
        if self.store.next_batch:
            # retoma de onde parou: as jogadas enviadas enquanto o bot estava fora estão no homeserver
            self.client.next_batch = self.store.next_batch
            log.info("retomando a partir do sync token salvo")
        else:
            # primeira execução: ignora o histórico antigo
            first = await self.client.sync(timeout=0, full_state=True)
            if isinstance(first, SyncResponse):
                self.store.next_batch = first.next_batch
        for g in self.store.games.values():
            g.turn_started_at = time.time()  # o relógio do turno recomeça depois de uma queda
        await self.ensure_lobby()
        self.client.add_event_callback(self.on_invite, InviteMemberEvent)
        self.client.add_event_callback(self.on_text, RoomMessageText)
        self.client.add_event_callback(self.on_custom, UnknownEvent)
        self.client.add_event_callback(self.on_member, RoomMemberEvent)
        self.client.add_response_callback(self.on_sync, SyncResponse)
        asyncio.create_task(self.timeout_loop())
        await self.client.sync_forever(timeout=30000, full_state=False)

    async def on_sync(self, resp: SyncResponse) -> None:
        # só grava o token depois de processar todos os eventos do lote (entrega "pelo menos uma vez";
        # a deduplicação por event_id evita aplicar duas vezes)
        self.store.next_batch = resp.next_batch
        self.store.save()

    # ------------------------------------------------------------ eventos
    async def on_invite(self, room: MatrixRoom, event: InviteMemberEvent) -> None:
        if event.state_key == self.client.user_id and event.membership == "invite":
            r = await self.client.join(room.room_id)
            if not isinstance(r, JoinError):
                await self.notice(room.room_id, "Olá! Digite !criar para abrir uma partida.\n" + P.HELP)

    async def on_text(self, room: MatrixRoom, event: RoomMessageText) -> None:
        move = P.parse_text(event.body)
        if move:
            await self.handle(room.room_id, event.sender, event.event_id, move)

    async def on_custom(self, room: MatrixRoom, event: UnknownEvent) -> None:
        if event.type == P.MOVE:
            move = P.parse_event(event.source.get("content", {}))
            if move:
                await self.handle(room.room_id, event.sender, event.event_id, move)

    async def on_member(self, room: MatrixRoom, event: RoomMemberEvent) -> None:
        g = self.store.games.get(room.room_id)
        if g and event.membership in ("leave", "ban") and event.state_key in g.players:
            await self.handle(room.room_id, event.state_key, event.event_id, P.Move("sair"))

    # ------------------------------------------------------------ jogadas
    async def handle(self, room_id: str, sender: str, event_id: str, move: P.Move) -> None:
        if sender == self.client.user_id:
            return
        async with self.lock:
            if self.store.seen(event_id):
                return
            self.store.mark(event_id)
            try:
                await self._handle(room_id, sender, event_id, move)
            except GameError as e:
                await self.reject(room_id, sender, event_id, str(e))
            except C.CardError as e:
                await self.reject(room_id, sender, event_id, str(e))
            self.store.save()

    async def _handle(self, room_id: str, sender: str, event_id: str, move: P.Move) -> None:
        a = move.action
        if a == "ajuda":
            return await self.notice(room_id, P.HELP)
        if a == "criar":
            return await self.create_game(room_id, sender)
        g = self.store.games.get(room_id)
        if g is None:
            raise GameError("esta sala não tem partida; use !criar")
        if a == "estado":
            return await self.notice(room_id, self.table_text(g))
        if a == "mao":
            return await self.send_hand(g, sender, force_text=True)
        # controle de concorrência otimista: a jogada foi pensada sobre o estado `seq`
        # (entrar/sair/iniciar comutam entre si e não precisam do controle)
        if move.seq is not None and move.seq != g.seq and a in ("jogar", "comprar", "passar"):
            raise GameError(f"jogada desatualizada (baseada no estado #{move.seq}, atual #{g.seq}); veja a mesa e jogue de novo")

        before = {p: list(h) for p, h in g.hands.items()}
        if a == "entrar":
            g.join(sender)
        elif a == "sair":
            g.leave(sender)
        elif a == "iniciar":
            g.start(sender)
        elif a == "jogar":
            if not move.card:
                raise GameError("diga qual carta: !jogar F7")
            g.play(sender, move.card, move.color, move.last_card)
        elif a == "comprar":
            g.draw(sender)
        elif a == "passar":
            g.pass_turn(sender)
        await self.after_change(g, before, event_id, sender)

    async def after_change(self, g: Game, before: dict, event_id: str | None, sender: str | None) -> None:
        self.store.save()
        await self.client.room_put_state(g.game_id, P.STATE, g.public_state())
        if event_id:
            await self.client.room_send(g.game_id, P.RESULT, {
                "in_reply_to": event_id, "sender": sender, "ok": True, "seq": g.seq})
        await self.notice(g.game_id, self.table_text(g, compact=True))
        for p in set(g.hands) | set(before):
            if g.hands.get(p) != before.get(p) or (p == g.current):
                await self.send_hand(g, p)
        await self.publish_lobby()

    async def reject(self, room_id: str, sender: str, event_id: str, reason: str) -> None:
        g = self.store.games.get(room_id)
        await self.client.room_send(room_id, P.RESULT, {
            "in_reply_to": event_id, "sender": sender, "ok": False, "reason": reason, "seq": g.seq if g else None})
        await self.notice(room_id, f"⚠ {short(sender)}: {reason}")

    # ------------------------------------------------------------ partidas
    async def create_game(self, origin_room: str, sender: str) -> None:
        self.store.counter += 1
        name = f"Última Carta — Partida {self.store.counter}"
        resp = await self.client.room_create(
            name=name, topic="Digite !entrar para participar e !iniciar para começar. !ajuda mostra os comandos.",
            preset=RoomPreset.public_chat, invite=[sender], power_level_override=self._power_levels())
        if isinstance(resp, RoomCreateError):
            raise GameError(f"não consegui criar a sala: {resp.message}")
        g = Game(game_id=resp.room_id, owner=sender, name=f"Partida {self.store.counter}")
        g.join(sender)
        self.store.games[g.game_id] = g
        await self.after_change(g, {}, None, None)
        await self.notice(origin_room, f"{short(sender)} criou a {name}. Entre na sala {resp.room_id} e digite !entrar.")

    async def publish_lobby(self) -> None:
        if not self.store.lobby_room:
            return
        games = [{"room_id": g.game_id, "name": g.name, "status": g.status, "owner": g.owner,
                  "players": g.players, "seq": g.seq}
                 for g in self.store.games.values() if g.status != "finished" and g.players]
        await self.client.room_put_state(self.store.lobby_room, P.LOBBY, {"games": games[-30:]})

    async def dm_room(self, user: str) -> str | None:
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

    async def send_hand(self, g: Game, user: str, force_text: bool = False) -> None:
        if user not in g.players:
            return
        room = await self.dm_room(user)
        if not room:
            return
        hand = sorted(g.hands.get(user, []), key=lambda c: (c[0], c))
        playable = g.playable_cards(user)
        await self.client.room_put_state(room, P.HAND, {
            "game_id": g.game_id, "seq": g.seq, "cards": hand, "playable": playable,
            "status": g.status}, state_key=g.game_id)
        text = f"Suas cartas: {' '.join(hand) or '(nenhuma)'}"
        if playable:
            text += f"\nJogáveis agora: {' '.join(playable)}"
        elif user == g.current:
            text += "\nNenhuma jogável: !comprar" if not g.has_drawn else "\nNenhuma jogável: !passar"
        await self.notice(room, text)

    def table_text(self, g: Game, compact: bool = False) -> str:
        last = g.log[-1] if g.log else ""
        if g.status == "lobby":
            return f"{last}\nJogadores: {', '.join(map(short, g.players))}. Digite !entrar para participar e !iniciar para começar."
        if g.status == "finished":
            return f"{last}\n🏆 {short(g.winner)} venceu! Use !criar no lobby para jogar de novo."
        counts = " · ".join(f"{short(p)}:{len(g.hands[p])}" for p in g.players)
        arrow = "→" if g.direction == 1 else "←"
        return (f"{last}\nMesa: {g.top} · cor {C.COLOR_NAMES[g.color]} · sentido {arrow}\n"
                f"Cartas: {counts}\nVez de {short(g.current)}")

    async def notice(self, room_id: str, text: str) -> None:
        await self.client.room_send(room_id, "m.room.message", {"msgtype": "m.notice", "body": text})

    # ------------------------------------------------------------ detecção de falha (timeout de turno)
    async def timeout_loop(self) -> None:
        while TURN_TIMEOUT > 0:
            await asyncio.sleep(2)
            now = time.time()
            for g in list(self.store.games.values()):
                if g.status != "playing" or now - g.turn_started_at < TURN_TIMEOUT:
                    continue
                async with self.lock:
                    if g.status != "playing" or time.time() - g.turn_started_at < TURN_TIMEOUT:
                        continue  # alguém jogou enquanto esperávamos o lock
                    before = {p: list(h) for p, h in g.hands.items()}
                    user = g.timeout()
                    if g.timeouts.get(user, 0) >= MAX_TIMEOUTS:
                        g.leave(user)
                        await self.notice(g.game_id, f"{short(user)} foi removido após {MAX_TIMEOUTS} timeouts seguidos")
                    try:
                        await self.after_change(g, before, None, None)
                    except Exception:
                        log.exception("falha publicando timeout")


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    logging.getLogger("nio").setLevel(logging.WARNING)
    bot = Bot()
    try:
        await bot.run()
    finally:
        await bot.client.close()


if __name__ == "__main__":
    asyncio.run(main())
