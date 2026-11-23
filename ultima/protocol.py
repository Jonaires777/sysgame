"""Contrato entre o bot árbitro e os clientes (ver docs/PROTOCOLO.md)."""
from __future__ import annotations

from dataclasses import dataclass

NS = "br.ufc.sysgame"
MOVE = f"{NS}.move"      # timeline, jogador -> bot
STATE = f"{NS}.state"    # state event (state_key ""), só o bot escreve: estado público da partida
HAND = f"{NS}.hand"      # state event na sala privada bot<->jogador (state_key = game_id): a mão
RESULT = f"{NS}.result"  # timeline, bot -> sala: jogada aceita/rejeitada
LOBBY = f"{NS}.lobby"    # state event da sala de lobby: partidas abertas

ACTIONS = {"criar", "entrar", "sair", "iniciar", "jogar", "comprar", "passar", "mao", "estado", "ajuda"}
# nomes aceitos no evento personalizado -> ação interna
EVENT_ACTIONS = {"create": "criar", "join": "entrar", "leave": "sair", "start": "iniciar", "play": "jogar",
                 "draw": "comprar", "pass": "passar", "hand": "mao", "state": "estado"}

HELP = (
    "Comandos do Última Carta:\n"
    "  !criar            cria uma partida nova\n"
    "  !entrar / !sair   entra ou sai da partida desta sala\n"
    "  !iniciar          começa a partida (2 a 8 jogadores)\n"
    "  !jogar F7         joga uma carta (cores: F Fogo, A Água, T Terra, V Vento)\n"
    "  !jogar C A        coringa escolhendo a cor (C+4 para o Coringa +4)\n"
    "  !jogar F7 ultima  joga e avisa que ficou com a última carta\n"
    "  !comprar / !passar\n"
    "  !mao / !estado    reenvia suas cartas / mostra a mesa"
)


@dataclass
class Move:
    action: str
    card: str | None = None
    color: str | None = None
    last_card: bool = False
    seq: int | None = None  # None: comando de texto, sem controle de concorrência


def parse_text(body: str) -> Move | None:
    """'!jogar c+4 vento ultima' -> Move. Devolve None se não for um comando."""
    parts = body.strip().split()
    if not parts or not parts[0].startswith("!"):
        return None
    action = parts[0][1:].lower().replace("ã", "a")
    if action not in ACTIONS:
        return Move("ajuda") if action in ("help", "regras") else None
    args = parts[1:]
    last = any(a.lower() in ("ultima", "última", "!ultima") for a in args)
    args = [a for a in args if a.lower() not in ("ultima", "última", "!ultima")]
    if action == "jogar":
        if not args:
            return Move("jogar")
        card, _, color = args[0].partition(":")
        color = color or (args[1] if len(args) > 1 else None)
        return Move("jogar", card=card, color=color, last_card=last)
    return Move(action)


def parse_event(content: dict) -> Move | None:
    action = EVENT_ACTIONS.get(content.get("action"))
    if action is None:
        return None
    seq = content.get("seq")
    return Move(
        action,
        card=content.get("card"),
        color=content.get("color"),
        last_card=bool(content.get("last_card")),
        seq=seq if isinstance(seq, int) else None,
    )
