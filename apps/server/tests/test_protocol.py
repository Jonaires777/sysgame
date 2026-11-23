from ultima.protocol import Move, parse_event, parse_text
from ultima.adapters.json_store import JsonStore as Store
from ultima.domain.engine import Game


def test_parse_text():
    assert parse_text("oi") is None
    assert parse_text("!comprar") == Move("comprar")
    assert parse_text("!jogar f7") == Move("jogar", card="f7")
    assert parse_text("!jogar C+4 vento ultima") == Move("jogar", card="C+4", color="vento", last_card=True)
    assert parse_text("!jogar C:A") == Move("jogar", card="C", color="A")
    assert parse_text("!mão") == Move("mao")
    assert parse_text("!xyz") is None


def test_parse_event():
    m = parse_event({"action": "play", "card": "F7", "seq": 4, "last_card": True})
    assert m == Move("jogar", card="F7", seq=4, last_card=True)
    assert parse_event({"action": "hack"}) is None
    assert parse_event({"action": "draw", "seq": "4"}).seq is None


def test_store_roundtrip_and_dedup(tmp_path):
    s = Store(tmp_path / "s.json")
    g = Game(game_id="!r", owner="a")
    g.join("a")
    s.games["!r"] = g
    s.next_batch = "tok"
    s.mark("$e1")
    s.save()
    s2 = Store(tmp_path / "s.json").load()
    assert s2.next_batch == "tok" and s2.seen("$e1") and not s2.seen("$e2")
    assert s2.games["!r"].players == ["a"]
