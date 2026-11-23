"""Testes da camada de aplicação com adaptadores falsos (sem Matrix, sem disco)."""
import asyncio

from ultima.application.service import GameService
from ultima.protocol import Move


class FakeRepo:
    def __init__(self):
        self.games, self.n, self.done, self.saves = {}, 0, set(), 0

    def get(self, game_id): return self.games.get(game_id)
    def add(self, game): self.games[game.game_id] = game
    def all(self): return list(self.games.values())
    def next_number(self):
        self.n += 1
        return self.n
    def save(self): self.saves += 1
    def seen(self, event_id): return event_id in self.done
    def mark(self, event_id): self.done.add(event_id)


class FakeNotifier:
    def __init__(self):
        self.results, self.states, self.hands, self.rooms = [], [], [], 0

    async def create_game_room(self, name, owner):
        self.rooms += 1
        return f"!sala{self.rooms}"
    async def publish_state(self, game): self.states.append(game.seq)
    async def publish_lobby(self, games): pass
    async def send_hand(self, game, user, as_text=False): self.hands.append(user)
    async def send_result(self, room_id, event_id, sender, ok, seq, reason=None):
        self.results.append((event_id, ok, reason))
    async def announce(self, room_id, text): pass
    async def show_table(self, game, full=False): pass

    def verdict(self, event_id):
        return next((ok, reason) for e, ok, reason in self.results if e == event_id)


def run(coro):
    return asyncio.run(coro)


def setup_game(service):
    async def go():
        g = await service.create_game("!lobby", "@a")
        await service.handle(g.game_id, "@b", "$j", Move("entrar"))
        await service.handle(g.game_id, "@a", "$s", Move("iniciar"))
        return g
    return run(go())


def test_create_join_start():
    repo, notif = FakeRepo(), FakeNotifier()
    g = setup_game(GameService(repo, notif))
    assert g.status == "playing" and sorted(g.players) == ["@a", "@b"]
    assert notif.verdict("$s") == (True, None)


def test_stale_seq_rejected_and_first_wins():
    repo, notif = FakeRepo(), FakeNotifier()
    svc = GameService(repo, notif)
    g = setup_game(svc)
    cur, seq = g.current, g.seq

    async def go():
        # duas jogadas sobre o mesmo estado: a primeira processada vale, a segunda é rejeitada
        await asyncio.gather(svc.handle(g.game_id, cur, "$1", Move("comprar", seq=seq)),
                             svc.handle(g.game_id, cur, "$2", Move("comprar", seq=seq)))
    run(go())
    assert notif.verdict("$1") == (True, None)
    ok, reason = notif.verdict("$2")
    assert not ok and "desatualizada" in reason
    assert g.seq == seq + 1


def test_redelivered_event_applied_once():
    repo, notif = FakeRepo(), FakeNotifier()
    svc = GameService(repo, notif)
    g = setup_game(svc)
    seq = g.seq
    run(svc.handle(g.game_id, g.current, "$x", Move("comprar")))
    run(svc.handle(g.game_id, g.current, "$x", Move("comprar")))  # mesmo event_id
    assert g.seq == seq + 1


def test_out_of_turn_rejected():
    repo, notif = FakeRepo(), FakeNotifier()
    svc = GameService(repo, notif)
    g = setup_game(svc)
    other = next(p for p in g.players if p != g.current)
    run(svc.handle(g.game_id, other, "$o", Move("comprar")))
    ok, reason = notif.verdict("$o")
    assert not ok and "não é a sua vez" in reason


def test_timeouts_remove_player():
    repo, notif = FakeRepo(), FakeNotifier()
    svc = GameService(repo, notif, turn_timeout=10, max_timeouts=1)
    g = setup_game(svc)
    first = g.current
    expired = run(svc.check_timeouts(now=g.turn_started_at + 11))
    assert expired == [first]
    assert g.status == "finished" and g.winner != first


def test_no_game_in_room():
    repo, notif = FakeRepo(), FakeNotifier()
    svc = GameService(repo, notif)
    run(svc.handle("!nada", "@a", "$n", Move("comprar")))
    assert notif.verdict("$n")[0] is False
