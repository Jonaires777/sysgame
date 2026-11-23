"""Persistência do bot: um JSON gravado de forma atômica (escreve em .tmp e renomeia)."""
from __future__ import annotations

import json
import os
from collections import deque
from pathlib import Path

from .engine import Game

PROCESSED_MAX = 2000


class Store:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.next_batch: str | None = None
        self.lobby_room: str | None = None
        self.games: dict[str, Game] = {}
        self.dm_rooms: dict[str, str] = {}
        self.counter = 0
        self.processed: deque[str] = deque(maxlen=PROCESSED_MAX)
        self._processed_set: set[str] = set()

    def load(self) -> "Store":
        if self.path.exists():
            d = json.loads(self.path.read_text(encoding="utf-8"))
            self.next_batch = d.get("next_batch")
            self.lobby_room = d.get("lobby_room")
            self.games = {k: Game.from_dict(v) for k, v in d.get("games", {}).items()}
            self.dm_rooms = d.get("dm_rooms", {})
            self.counter = d.get("counter", 0)
            for e in d.get("processed", []):
                self.mark(e)
        return self

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({
            "next_batch": self.next_batch,
            "lobby_room": self.lobby_room,
            "games": {k: g.to_dict() for k, g in self.games.items()},
            "dm_rooms": self.dm_rooms,
            "counter": self.counter,
            "processed": list(self.processed),
        }, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.path)

    # deduplicação: um evento reentregue (ex.: depois de uma queda) não é aplicado duas vezes
    def seen(self, event_id: str) -> bool:
        return event_id in self._processed_set

    def mark(self, event_id: str) -> None:
        if len(self.processed) == self.processed.maxlen:
            self._processed_set.discard(self.processed[0])
        self.processed.append(event_id)
        self._processed_set.add(event_id)
