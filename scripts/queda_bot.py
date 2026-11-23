"""Demonstração de tolerância a falhas (issue #8): o bot árbitro cai no meio da partida.

  1. Cria uma partida com 2 jogadores e começa.
  2. Derruba o bot de forma abrupta (docker compose kill bot, SIGKILL).
  3. O jogador da vez joga enquanto o bot está fora: a jogada fica guardada no homeserver,
     mas ninguém a valida, então o estado não muda.
  4. Religa o bot (docker compose start bot): ele retoma do sync token salvo, encontra a
     jogada pendente e a aplica. O estado avança exatamente uma vez.

Roda na máquina hospedeira (precisa do comando docker):
  python scripts/queda_bot.py
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from ultima.player import Player  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")


def compose(*args: str) -> None:
    print(f"   $ docker compose {' '.join(args)}")
    subprocess.run(["docker", "compose", *args], cwd=ROOT, check=True, capture_output=True)


def short(u: str) -> str:
    return u[1:].split(":", 1)[0]


async def main() -> None:
    players = [Player(f"queda{i + 1}", "senha-queda") for i in range(2)]
    for p in players:
        await p.connect()
    tasks = [asyncio.create_task(p.sync_forever()) for p in players]
    a, b = players
    game = await a.create_game()
    await b.join_game(game)
    await a.wait(lambda: len(a.games[game]["players"]) == 2)
    await a.move(game, "start")
    await a.wait(lambda: a.games[game]["status"] == "playing")
    st = a.games[game]
    print(f"1) Partida iniciada. Estado #{st['seq']}, vez de {short(st['current'])}")

    print("2) Matando o bot árbitro (SIGKILL)")
    compose("kill", "bot")  # SIGKILL: queda abrupta, sem chance de salvar nada

    cur = a if st["current"] == a.user_id else b
    seq = st["seq"]
    await cur.wait(lambda: cur.hands.get(game, {}).get("seq") == seq)
    hand = cur.hands[game]
    if hand["playable"]:
        card = hand["playable"][0]
        await cur.send_move(game, "play", seq, card=card, color="A" if card.startswith("C") else None)
        what = f"jogar {card}"
    else:
        await cur.send_move(game, "draw", seq)
        what = "comprar"
    print(f"3) Com o bot fora, {short(cur.user_id)} envia '{what}' (baseada no estado #{seq})")
    await asyncio.sleep(4)
    print(f"   4 s depois o estado continua #{a.games[game]['seq']} — ninguém validou a jogada ainda")

    print("4) Religando o bot")
    t0 = time.time()
    compose("start", "bot")
    await a.wait(lambda: a.games[game]["seq"] > seq, timeout=60)
    await asyncio.sleep(3)  # dá tempo de um eventual processamento duplicado aparecer
    st = a.games[game]
    print(f"   Em {time.time() - t0:.1f} s o bot voltou e aplicou a jogada pendente: estado #{st['seq']}")
    print(f"   Último registro: {st['log'][-1]}")
    ok = st["seq"] == seq + 1
    print(f"   Aplicada exatamente uma vez? {'SIM' if ok else 'NÃO'} (esperado #{seq + 1})")

    for t in tasks:
        t.cancel()
    for p in players:
        await p.close()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    asyncio.run(main())
