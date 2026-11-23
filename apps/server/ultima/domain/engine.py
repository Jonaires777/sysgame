"""Motor de regras do Última Carta: Python puro, sem nada de Matrix.

O bot árbitro é o único que instancia e altera um Game. Cada mudança aceita incrementa
`seq`; os clientes mandam o `seq` que viram e o bot rejeita jogadas desatualizadas.
"""
from __future__ import annotations

import random
import time
from dataclasses import asdict, dataclass, field

from . import cards as C

HAND_SIZE = 7
MIN_PLAYERS = 2
MAX_PLAYERS = 8
LOG_SIZE = 30


class GameError(Exception):
    """Jogada inválida; a mensagem é mostrada ao jogador."""


@dataclass
class Game:
    game_id: str
    owner: str
    name: str = ""
    players: list[str] = field(default_factory=list)
    hands: dict[str, list[str]] = field(default_factory=dict)
    draw_pile: list[str] = field(default_factory=list)
    discard: list[str] = field(default_factory=list)
    color: str | None = None
    turn: int = 0
    direction: int = 1
    seq: int = 0
    status: str = "lobby"  # lobby | playing | finished
    winner: str | None = None
    has_drawn: bool = False
    drawn_card: str | None = None
    timeouts: dict[str, int] = field(default_factory=dict)
    turn_started_at: float = 0.0
    log: list[str] = field(default_factory=list)
    rng_state: int | None = None

    # ------------------------------------------------------------ consultas
    @property
    def current(self) -> str | None:
        return self.players[self.turn] if self.status == "playing" and self.players else None

    @property
    def top(self) -> str | None:
        return self.discard[-1] if self.discard else None

    def can_play(self, card: str) -> bool:
        if C.is_wild(card):
            return True
        top = self.top
        return C.color_of(card) == self.color or (top is not None and not C.is_wild(top) and C.value_of(card) == C.value_of(top))

    def playable_cards(self, user: str) -> list[str]:
        if user != self.current:
            return []
        hand = self.hands.get(user, [])
        if self.has_drawn:
            return [self.drawn_card] if self.drawn_card in hand and self.can_play(self.drawn_card) else []
        return sorted({c for c in hand if self.can_play(c)})

    def public_state(self) -> dict:
        return {
            "game_id": self.game_id,
            "owner": self.owner,
            "name": self.name,
            "status": self.status,
            "seq": self.seq,
            "players": list(self.players),
            "hand_counts": {p: len(self.hands.get(p, [])) for p in self.players},
            "top_card": self.top,
            "color": self.color,
            "current": self.current,
            "direction": self.direction,
            "has_drawn": self.has_drawn,
            "draw_pile": len(self.draw_pile),
            "winner": self.winner,
            "log": self.log[-10:],
        }

    # ------------------------------------------------------------ lobby
    def join(self, user: str) -> None:
        if user in self.players:
            raise GameError("você já está na partida")
        if self.status != "lobby":
            raise GameError("a partida já começou")
        if len(self.players) >= MAX_PLAYERS:
            raise GameError(f"partida cheia (máximo {MAX_PLAYERS})")
        self.players.append(user)
        self.hands[user] = []
        self._commit(f"{user} entrou")

    def leave(self, user: str) -> None:
        self._require_player(user)
        idx = self.players.index(user)
        self.draw_pile[:0] = self.hands.pop(user, [])  # cartas voltam para o fundo do monte
        self.players.pop(idx)
        self.timeouts.pop(user, None)
        if self.status == "playing":
            if len(self.players) == 1:
                self._finish(self.players[0])
                self._commit(f"{user} saiu; {self.players[0]} venceu por W.O.")
                return
            if idx < self.turn:
                self.turn -= 1
            elif idx == self.turn:
                self.turn %= len(self.players)
                if self.direction == -1:
                    self.turn = (self.turn - 1) % len(self.players)
                self._new_turn()
            self.turn %= len(self.players)
        elif self.owner == user and self.players:
            self.owner = self.players[0]
        self._commit(f"{user} saiu")

    def start(self, user: str, seed: int | None = None) -> None:
        self._require_player(user)
        if self.status != "lobby":
            raise GameError("a partida já começou")
        if len(self.players) < MIN_PLAYERS:
            raise GameError(f"são necessários pelo menos {MIN_PLAYERS} jogadores")
        rng = random.Random(seed)
        self.draw_pile = C.new_deck(rng)
        rng.shuffle(self.players)
        for p in self.players:
            self.hands[p] = [self.draw_pile.pop() for _ in range(HAND_SIZE)]
        # a primeira carta da mesa é sempre numérica
        while True:
            card = self.draw_pile.pop()
            if C.value_of(card) in C.NUMBERS:
                break
            self.draw_pile.insert(0, card)
        self.discard = [card]
        self.color = C.color_of(card)
        self.status = "playing"
        self.turn = 0
        self.direction = 1
        self._new_turn()
        self._commit(f"partida iniciada; mesa: {card}; começa {self.current}")

    # ------------------------------------------------------------ jogadas
    def play(self, user: str, card: str, color: str | None = None, declared_last: bool = False) -> None:
        self._require_turn(user)
        card = C.normalize(card)
        hand = self.hands[user]
        if card not in hand:
            raise GameError(f"você não tem {card}")
        if self.has_drawn and card != self.drawn_card:
            raise GameError(f"depois de comprar, só pode jogar a carta comprada ({self.drawn_card}) ou passar")
        if not self.can_play(card):
            raise GameError(f"{card} não combina com {self.top} (cor atual: {C.COLOR_NAMES.get(self.color, self.color)})")
        if C.is_wild(card):
            if not color:
                raise GameError("escolha a cor do coringa (F, A, T ou V)")
            color = C.normalize_color(color)
        hand.remove(card)
        self.discard.append(card)
        self.color = color if C.is_wild(card) else C.color_of(card)
        self.timeouts[user] = 0
        msg = f"{user} jogou {card}" + (f" e escolheu {C.COLOR_NAMES[self.color]}" if C.is_wild(card) else "")

        if not hand:
            self._finish(user)
            self._commit(msg + f"; {user} venceu!")
            return
        if len(hand) == 1 and not declared_last:
            self._give(user, 2)
            msg += "; esqueceu de avisar a última carta e comprou 2"
        elif len(hand) == 1:
            msg += " — ÚLTIMA CARTA!"

        value = C.value_of(card)
        n = len(self.players)
        if value == "I":
            self.direction *= -1
            if n == 2:
                self._advance()  # com 2 jogadores, Inverte funciona como Bloqueio
        if value in ("B", "+2", "C+4"):
            victim = self.players[(self.turn + self.direction) % n]
            if value != "B":
                k = 2 if value == "+2" else 4
                self._give(victim, k)
                msg += f"; {victim} comprou {k}"
            msg += f"; {victim} perdeu a vez"
            self._advance()
        self._advance()
        self._new_turn()
        self._commit(msg)

    def draw(self, user: str) -> str:
        self._require_turn(user)
        if self.has_drawn:
            raise GameError("você já comprou nesta vez; jogue a carta comprada ou passe")
        card = self._give(user, 1)[0]
        self.has_drawn = True
        self.drawn_card = card
        self.timeouts[user] = 0
        self._commit(f"{user} comprou uma carta")
        return card

    def pass_turn(self, user: str) -> None:
        self._require_turn(user)
        if not self.has_drawn:
            raise GameError("compre uma carta antes de passar")
        self._advance()
        self._new_turn()
        self._commit(f"{user} passou")

    def timeout(self) -> str:
        """Jogador da vez não respondeu: compra (se ainda não comprou) e passa. Devolve quem foi."""
        user = self.current
        if user is None:
            raise GameError("não há partida em andamento")
        if not self.has_drawn:
            self._give(user, 1)
        self.timeouts[user] = self.timeouts.get(user, 0) + 1
        self._advance()
        self._new_turn()
        self._commit(f"{user} não jogou a tempo: comprou e passou a vez")
        return user

    # ------------------------------------------------------------ internos
    def _require_player(self, user: str) -> None:
        if user not in self.players:
            raise GameError("você não está nesta partida")

    def _require_turn(self, user: str) -> None:
        if self.status != "playing":
            raise GameError("a partida não está em andamento")
        self._require_player(user)
        if user != self.current:
            raise GameError(f"não é a sua vez (vez de {self.current})")

    def _advance(self) -> None:
        self.turn = (self.turn + self.direction) % len(self.players)

    def _new_turn(self) -> None:
        self.has_drawn = False
        self.drawn_card = None
        self.turn_started_at = time.time()

    def _give(self, user: str, k: int) -> list[str]:
        got = []
        for _ in range(k):
            if not self.draw_pile:
                self._reshuffle()
            if not self.draw_pile:
                break  # todas as cartas estão nas mãos
            got.append(self.draw_pile.pop())
        self.hands[user] += got
        return got

    def _reshuffle(self) -> None:
        if len(self.discard) <= 1:
            return
        top = self.discard.pop()
        self.draw_pile = self.discard
        random.shuffle(self.draw_pile)
        self.discard = [top]

    def _finish(self, winner: str) -> None:
        self.status = "finished"
        self.winner = winner

    def _commit(self, message: str) -> None:
        self.seq += 1
        self.log.append(f"#{self.seq} {message}")
        del self.log[:-LOG_SIZE]

    # ------------------------------------------------------------ persistência
    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Game":
        return cls(**d)
