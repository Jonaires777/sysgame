"""Casos de uso do jogo (camada de aplicação).

O GameService é o sequenciador: recebe jogadas já traduzidas do transporte (protocol.Move),
aplica idempotência, controle de concorrência otimista (seq) e as regras do domínio, e avisa
os jogadores pelas portas. Não sabe nada de Matrix nem de arquivos.
"""
from __future__ import annotations

import asyncio
import time

from .. import protocol as P
from ..domain import cards as C
from ..domain.engine import Game, GameError
from .ports import GameNotifier, GameRepository

# ações sujeitas ao controle de concorrência otimista; entrar/sair/iniciar comutam entre si
SEQUENCED = ("jogar", "comprar", "passar")


class GameService:
    def __init__(self, repo: GameRepository, notifier: GameNotifier,
                 turn_timeout: float = 90, max_timeouts: int = 3):
        self.repo = repo
        self.notifier = notifier
        self.turn_timeout = turn_timeout
        self.max_timeouts = max_timeouts
        self.lock = asyncio.Lock()  # uma jogada por vez: é isso que define a ordem

    # ------------------------------------------------------------ caso de uso: processar jogada
    async def handle(self, room_id: str, sender: str, event_id: str, move: P.Move) -> None:
        async with self.lock:
            if self.repo.seen(event_id):
                return  # evento reentregue: já aplicado
            self.repo.mark(event_id)
            try:
                await self._dispatch(room_id, sender, event_id, move)
            except (GameError, C.CardError) as e:
                game = self.repo.get(room_id)
                await self.notifier.send_result(room_id, event_id, sender, False, game.seq if game else None, str(e))
            self.repo.save()

    async def _dispatch(self, room_id: str, sender: str, event_id: str, move: P.Move) -> None:
        a = move.action
        if a == "ajuda":
            return await self.notifier.announce(room_id, P.HELP)
        if a == "criar":
            return await self.create_game(room_id, sender)
        g = self.repo.get(room_id)
        if g is None:
            raise GameError("esta sala não tem partida; use !criar")
        if a == "estado":
            return await self.notifier.show_table(g, full=True)
        if a == "mao":
            return await self.notifier.send_hand(g, sender, as_text=True)
        if move.seq is not None and move.seq != g.seq and a in SEQUENCED:
            raise GameError(f"jogada desatualizada (baseada no estado #{move.seq}, atual #{g.seq}); "
                            "veja a mesa e jogue de novo")

        before = _hands(g)
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
        await self._changed(g, before)
        await self.notifier.send_result(room_id, event_id, sender, True, g.seq)

    # ------------------------------------------------------------ caso de uso: criar partida
    async def create_game(self, origin_room: str, owner: str) -> Game:
        n = self.repo.next_number()
        name = f"Partida {n}"
        room_id = await self.notifier.create_game_room(f"Última Carta — {name}", owner)
        g = Game(game_id=room_id, owner=owner, name=name)
        g.join(owner)
        self.repo.add(g)
        await self._changed(g, {})
        await self.notifier.announce(origin_room, f"{owner} criou a {name} ({room_id}). Entre na sala e digite !entrar.")
        return g

    # ------------------------------------------------------------ caso de uso: timeout de turno
    async def check_timeouts(self, now: float | None = None) -> list[str]:
        """Detector de falhas: o jogador da vez que passou do prazo compra e passa. Devolve quem foi."""
        if self.turn_timeout <= 0:
            return []
        expired = []
        async with self.lock:
            now = now or time.time()
            for g in self.repo.all():
                if g.status != "playing" or now - g.turn_started_at < self.turn_timeout:
                    continue
                before = _hands(g)
                user = g.timeout()
                expired.append(user)
                if g.timeouts.get(user, 0) >= self.max_timeouts:
                    g.leave(user)
                    await self.notifier.announce(g.game_id, f"{user} foi removido após {self.max_timeouts} timeouts seguidos")
                await self._changed(g, before)
            if expired:
                self.repo.save()
        return expired

    def restart_turn_clocks(self) -> list[Game]:
        """Depois de uma queda, o prazo da vez recomeça (o tempo fora do ar não conta contra o jogador)."""
        playing = [g for g in self.repo.all() if g.status == "playing"]
        for g in playing:
            g.turn_started_at = time.time()
        return playing

    # ------------------------------------------------------------ interno
    async def _changed(self, g: Game, before: dict[str, list[str]]) -> None:
        """Depois de uma mudança aceita: persiste e replica o estado para todos."""
        self.repo.save()
        await self.notifier.publish_state(g)
        await self.notifier.show_table(g)
        for p in set(g.hands) | set(before):
            if g.hands.get(p) != before.get(p) or p == g.current:
                await self.notifier.send_hand(g, p)
        await self.notifier.publish_lobby(self.repo.all())


def _hands(g: Game) -> dict[str, list[str]]:
    return {p: list(h) for p, h in g.hands.items()}
