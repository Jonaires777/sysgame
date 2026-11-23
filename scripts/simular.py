"""Simulador de jogadores: N jogadores automáticos jogam uma partida inteira.

Serve como teste de ponta a ponta (homeserver + bot) e para encher a mesa durante a demo.

  python scripts/simular.py                       # 3 robôs jogam entre si
  python scripts/simular.py --entrar '!sala:localhost' --jogadores 2   # robôs entram numa partida existente
  docker compose run --rm cli python scripts/simular.py
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from ultima import cards as C  # noqa: E402
from ultima.player import Player  # noqa: E402


async def robot(p: Player, game: str, delay: float) -> None:
    """Joga sempre que for a vez dele, com uma estratégia simples."""
    seen = -1
    while True:
        st = p.games.get(game, {})
        if st.get("status") == "finished":
            return
        hand = p.hands.get(game)
        if st.get("status") == "playing" and st.get("current") == p.user_id and hand and hand["seq"] == st["seq"] and st["seq"] != seen:
            seen = st["seq"]
            await asyncio.sleep(delay)
            playable = hand["playable"]
            if playable:
                card = sorted(playable, key=lambda c: C.is_wild(c))[0]  # guarda coringas para depois
                colors = [C.color_of(c) for c in hand["cards"] if not C.is_wild(c)]
                color = max(set(colors), key=colors.count) if colors else random.choice(C.COLORS)
                await p.move(game, "play", card=card, color=color if C.is_wild(card) else None,
                             last_card=len(hand["cards"]) == 2)
            elif st.get("has_drawn"):
                await p.move(game, "pass")
            else:
                await p.move(game, "draw")
        p.changed.clear()
        try:
            await asyncio.wait_for(p.changed.wait(), 5)
        except asyncio.TimeoutError:
            pass


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jogadores", type=int, default=3)
    ap.add_argument("--prefixo", default="robo")
    ap.add_argument("--entrar", help="room_id de uma partida já criada (os robôs só entram)")
    ap.add_argument("--atraso", type=float, default=1.0, help="segundos antes de cada jogada")
    a = ap.parse_args()

    players = [Player(f"{a.prefixo}{i + 1}", "senha-robo") for i in range(a.jogadores)]
    for p in players:
        await p.connect()
    syncs = [asyncio.create_task(p.sync_forever()) for p in players]

    if a.entrar:
        game = a.entrar
        for p in players:
            await p.join_game(game)
    else:
        game = await players[0].create_game()
        print("partida criada:", game)
        for p in players[1:]:
            await p.join_game(game)
        await players[0].wait(lambda: len(players[0].games[game]["players"]) == len(players))
        await players[0].move(game, "start")
    print("robôs na partida; jogando…")

    await asyncio.gather(*(robot(p, game, a.atraso) for p in players))
    st = players[0].games[game]
    print(f"fim: {st['winner']} venceu em {st['seq']} passos")
    for line in st["log"]:
        print("  ", line)
    for t in syncs:
        t.cancel()
    for p in players:
        await p.close()


if __name__ == "__main__":
    asyncio.run(main())
