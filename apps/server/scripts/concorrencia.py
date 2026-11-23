"""Demonstração de jogadas concorrentes (issue #11).

Monta uma partida com 3 jogadores e executa três cenários, mostrando o que o bot árbitro decidiu
para cada jogada e em que ordem as jogadas entraram na timeline da sala:

  1. Mesmo jogador, dois dispositivos: o jogador da vez manda "jogar" e "comprar" ao mesmo
     tempo, ambas baseadas no mesmo estado (mesmo seq). Só a primeira na timeline vale.
  2. Todos ao mesmo tempo: os 3 jogadores mandam uma jogada no mesmo instante. Só a do jogador
     da vez é aceita; as outras são rejeitadas.
  3. Reenvio (retransmissão): a mesma jogada é enviada duas vezes com o mesmo ID de transação.
     O homeserver deduplica (PUT idempotente) e devolve o mesmo event_id; o bot aplica uma vez só.

  python scripts/concorrencia.py
  docker compose run --rm --entrypoint python robos scripts/concorrencia.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import time
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from ultima import protocol as P  # noqa: E402
from ultima.client.player import Player  # noqa: E402


def short(u: str) -> str:
    return u[1:].split(":", 1)[0]


class Demo:
    def __init__(self, players: list[Player]):
        self.players = players
        self.game = ""
        self.results: dict[str, dict] = {}  # event_id da jogada -> resultado publicado pelo bot

    @property
    def p0(self) -> Player:
        return self.players[0]

    def state(self) -> dict:
        return self.p0.games[self.game]

    def by_id(self, user: str) -> Player:
        return next(p for p in self.players if p.user_id == user)

    async def wait_results(self, event_ids: list[str], timeout: float = 20) -> None:
        def done():
            for p in self.players:
                for r in p.results:
                    self.results[r["in_reply_to"]] = r
            return all(e in self.results for e in event_ids)
        deadline = time.time() + timeout
        while not done():
            if time.time() > deadline:
                raise TimeoutError("o bot não respondeu a todas as jogadas")
            await asyncio.sleep(0.2)

    async def ready_hand(self) -> tuple[Player, dict]:
        """Espera a mão do jogador da vez corresponder ao estado atual."""
        await self.p0.wait(lambda: self.state()["status"] == "playing")
        while True:
            cur = self.by_id(self.state()["current"])
            hand = cur.hands.get(self.game)
            if hand and hand["seq"] == self.state()["seq"] and cur.games[self.game]["seq"] == self.state()["seq"]:
                return cur, hand
            await asyncio.sleep(0.2)

    async def timeline_order(self, event_ids: list[str]) -> list[str]:
        """Ordem em que as jogadas aparecem na timeline da sala (o que o bot vê)."""
        resp = await self.p0.client.room_messages(self.game, start="", limit=60, message_filter={"types": [P.MOVE]})
        ids = [getattr(e, "event_id", None) for e in reversed(resp.chunk)]
        return [e for e in ids if e in event_ids]

    def report(self, title: str, sent: list[tuple[str, str, str, int]], order: list[str]) -> None:
        print(f"\n{title}")
        print(f"  {'ordem':<6}{'jogador':<12}{'jogada':<16}{'seq':<6}resultado")
        pos = {e: i + 1 for i, e in enumerate(order)}
        for eid, user, desc, seq in sorted(sent, key=lambda s: pos.get(s[0], 99)):
            r = self.results.get(eid, {})
            verdict = "ACEITA" if r.get("ok") else f"rejeitada: {r.get('reason')}"
            print(f"  {pos.get(eid, '?'):<6}{short(user):<12}{desc:<16}{seq:<6}{verdict}")

    # ------------------------------------------------------------ cenários
    async def scenario_same_player(self) -> None:
        cur, hand = await self.ready_hand()
        seq = self.state()["seq"]
        if hand["playable"]:
            card = hand["playable"][0]
            a = cur.send_move(self.game, "play", seq, card=card, color="F" if card.startswith("C") else None)
            desc_a = f"jogar {card}"
        else:
            a = cur.send_move(self.game, "draw", seq)
            desc_a = "comprar"
        b = cur.send_move(self.game, "draw", seq)
        ea, eb = await asyncio.gather(a, b)  # as duas saem ao mesmo tempo
        await self.wait_results([ea, eb])
        self.report("1) Mesmo jogador, duas jogadas sobre o mesmo estado (dois dispositivos / clique duplo)",
                    [(ea, cur.user_id, desc_a, seq), (eb, cur.user_id, "comprar", seq)],
                    await self.timeline_order([ea, eb]))

    async def scenario_everyone(self) -> None:
        cur, _ = await self.ready_hand()
        seq = self.state()["seq"]
        sends = [p.send_move(self.game, "draw", seq) for p in self.players]
        ids = await asyncio.gather(*sends)
        await self.wait_results(list(ids))
        self.report(f"2) Os 3 jogadores enviam 'comprar' no mesmo instante (vez de {short(cur.user_id)})",
                    [(e, p.user_id, "comprar", seq) for e, p in zip(ids, self.players)],
                    await self.timeline_order(list(ids)))

    async def scenario_retransmit(self) -> None:
        cur, _ = await self.ready_hand()
        seq = self.state()["seq"]
        before = self.state()["seq"]
        txn = uuid.uuid4().hex
        content = {"action": "pass" if self.state()["has_drawn"] else "draw", "game_id": self.game, "seq": seq}
        r1, r2 = await asyncio.gather(
            cur.client.room_send(self.game, P.MOVE, content, tx_id=txn),
            cur.client.room_send(self.game, P.MOVE, content, tx_id=txn))
        await self.wait_results([r1.event_id])
        await asyncio.sleep(1.5)
        after = self.state()["seq"]
        print("\n3) Retransmissão: a mesma jogada enviada 2x com o mesmo ID de transação")
        print(f"  event_id do 1º envio: {r1.event_id}")
        print(f"  event_id do 2º envio: {r2.event_id}")
        print(f"  mesmo evento? {'SIM' if r1.event_id == r2.event_id else 'NÃO'} — "
              f"estado avançou {after - before} passo(s) (esperado: 1)")


async def main() -> None:
    players = [Player(f"conc{i + 1}", "senha-conc") for i in range(3)]
    for p in players:
        await p.connect()
    tasks = [asyncio.create_task(p.sync_forever()) for p in players]
    demo = Demo(players)
    demo.game = await players[0].create_game()
    for p in players[1:]:
        await p.join_game(demo.game)
    await players[0].wait(lambda: len(players[0].games[demo.game]["players"]) == 3)
    await players[0].move(demo.game, "start")
    print(f"Partida {demo.game} iniciada com {', '.join(short(p.user_id) for p in players)}")
    print("A coluna 'ordem' é a posição da jogada na timeline da sala — a ordem em que o bot as processa.")

    await demo.scenario_same_player()
    await demo.scenario_everyone()
    await demo.scenario_retransmit()

    for t in tasks:
        t.cancel()
    for p in players:
        await p.close()


if __name__ == "__main__":
    asyncio.run(main())
