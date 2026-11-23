import pytest

from ultima import cards as C
from ultima.engine import Game, GameError


def make(n=3, seed=1):
    g = Game(game_id="!sala", owner="p0")
    for i in range(n):
        g.join(f"p{i}")
    g.start("p0", seed=seed)
    return g


def rig(g, top, color=None, hands=None):
    """Força mesa e mãos para testar uma regra específica."""
    g.discard = [top]
    g.color = color or C.color_of(top)
    for p, h in (hands or {}).items():
        g.hands[p] = list(h)


def test_deck_composition():
    d = C.new_deck()
    assert len(d) == 108
    assert d.count("C") == 4 and d.count("C+4") == 4
    assert d.count("F0") == 1 and d.count("F7") == 2 and d.count("A+2") == 2


def test_start_deals_and_numeric_top():
    g = make()
    assert g.status == "playing"
    assert all(len(g.hands[p]) == 7 for p in g.players)
    assert C.value_of(g.top) in C.NUMBERS
    assert len(g.draw_pile) + len(g.discard) + 21 == 108


def test_join_rules():
    g = Game(game_id="x", owner="a")
    g.join("a")
    with pytest.raises(GameError):
        g.join("a")
    with pytest.raises(GameError):
        g.start("a")  # só 1 jogador


def test_play_out_of_turn_rejected():
    g = make()
    other = g.players[1]
    with pytest.raises(GameError, match="não é a sua vez"):
        g.play(other, g.hands[other][0])


def test_seq_increments_only_on_accepted():
    g = make()
    s = g.seq
    with pytest.raises(GameError):
        g.pass_turn(g.current)  # passar sem comprar
    assert g.seq == s
    g.draw(g.current)
    assert g.seq == s + 1


def test_match_by_color_and_value():
    g = make()
    p = g.current
    rig(g, "F5", hands={p: ["A5", "F9", "T1", "V2"]})
    assert g.playable_cards(p) == ["A5", "F9"]
    with pytest.raises(GameError):
        g.play(p, "T1")
    g.play(p, "a5")  # aceita minúscula
    assert g.color == "A"


def test_wild_requires_color():
    g = make()
    p = g.current
    rig(g, "F5", hands={p: ["C", "T1", "V2"]})
    with pytest.raises(GameError, match="cor"):
        g.play(p, "C")
    g.play(p, "C", color="vento")
    assert g.color == "V"


def test_skip_and_draw_two():
    g = make(3)
    a, b, c = g.players
    rig(g, "F5", hands={a: ["F+2", "T1", "V2"], b: ["A1"], c: ["A2"]})
    g.play(a, "F+2")
    assert len(g.hands[b]) == 3
    assert g.current == c


def test_wild_draw_four():
    g = make(3)
    a, b, c = g.players
    rig(g, "F5", hands={a: ["C+4", "T1", "V2"], b: ["A1"], c: ["A2"]})
    g.play(a, "C+4", color="T")
    assert len(g.hands[b]) == 5 and g.current == c and g.color == "T"


def test_reverse():
    g = make(3)
    a, b, c = g.players
    rig(g, "F5", hands={a: ["FI", "T1", "V2"]})
    g.play(a, "FI")
    assert g.current == c and g.direction == -1


def test_reverse_with_two_players_skips():
    g = make(2)
    a, b = g.players
    rig(g, "F5", hands={a: ["FI", "T1", "V2"]})
    g.play(a, "FI")
    assert g.current == a


def test_draw_then_only_drawn_card_or_pass():
    g = make()
    p = g.current
    rig(g, "F5", hands={p: ["F1", "T2"]})
    g.draw_pile.append("V9")
    assert g.draw(p) == "V9"
    with pytest.raises(GameError, match="carta comprada"):
        g.play(p, "F1")
    with pytest.raises(GameError, match="já comprou"):
        g.draw(p)
    g.pass_turn(p)
    assert g.current != p


def test_last_card_penalty_and_declaration():
    g = make()
    p = g.current
    rig(g, "F5", hands={p: ["F1", "F2"]})
    g.play(p, "F1")
    assert len(g.hands[p]) == 3  # 1 + 2 de penalidade

    g2 = make()
    q = g2.current
    rig(g2, "F5", hands={q: ["F1", "F2"]})
    g2.play(q, "F1", declared_last=True)
    assert len(g2.hands[q]) == 1


def test_win():
    g = make()
    p = g.current
    rig(g, "F5", hands={p: ["F1"]})
    g.play(p, "F1")
    assert g.status == "finished" and g.winner == p
    with pytest.raises(GameError):
        g.draw(g.players[0])


def test_reshuffle_when_pile_empty():
    g = make()
    p = g.current
    g.discard = ["F1", "F2", "F3"]
    g.draw_pile = []
    g.draw(p)
    assert g.discard == ["F3"]
    assert len(g.draw_pile) == 1


def test_timeout_draws_and_passes():
    g = make()
    p = g.current
    n = len(g.hands[p])
    assert g.timeout() == p
    assert len(g.hands[p]) == n + 1 and g.current != p and g.timeouts[p] == 1


def test_leave_current_player_passes_turn():
    g = make(3)
    a, b, c = g.players
    g.leave(a)
    assert g.players == [b, c] and g.current == b


def test_leave_down_to_one_player_wins():
    g = make(2)
    a, b = g.players
    g.leave(a)
    assert g.status == "finished" and g.winner == b


def test_serialization_roundtrip():
    g = make()
    g2 = Game.from_dict(g.to_dict())
    assert g2.public_state() == g.public_state()
    assert g2.hands == g.hands


def _floats(x):
    if isinstance(x, float):
        return True
    if isinstance(x, dict):
        return any(_floats(v) for v in x.values())
    if isinstance(x, list):
        return any(_floats(v) for v in x)
    return False


def test_public_state_has_no_floats():
    # o Matrix recusa eventos com números de ponto flutuante (M_BAD_JSON)
    g = make()
    g.timeout()
    assert not _floats(g.public_state())
