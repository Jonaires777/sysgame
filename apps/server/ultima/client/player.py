"""Cliente de jogador em Python (matrix-nio), usado pelo CLI e pelo simulador de jogadores.

Mantém uma réplica local do estado público (state event do bot) e da própria mão,
alimentada pelo /sync. Só aceita estado vindo do bot.
"""
from __future__ import annotations

import asyncio
import os

from nio import AsyncClient, LoginResponse, SyncResponse

from .. import protocol as P

HOMESERVER = os.environ.get("HOMESERVER", "http://localhost:8008")


class Player:
    def __init__(self, user: str, password: str, homeserver: str = HOMESERVER, bot: str | None = None):
        self.client = AsyncClient(homeserver, user)
        self.password = password
        self.bot = bot
        self.lobby: str | None = None
        self.games: dict[str, dict] = {}        # room_id -> estado público
        self.hands: dict[str, dict] = {}        # game_id -> mão
        self.lobby_games: list[dict] = []
        self.messages: list[tuple[str, str, str]] = []  # (room_id, sender, body)
        self.results: list[dict] = []           # resultados (aceita/rejeita) das minhas jogadas
        self.changed = asyncio.Event()

    @property
    def user_id(self) -> str:
        return self.client.user_id

    async def connect(self, register: bool = True) -> None:
        resp = await self.client.login(self.password, device_name="ultima-py")
        if not isinstance(resp, LoginResponse):
            if not register:
                raise RuntimeError(f"login falhou: {resp.message}")
            reg = await self.client.register(self.client.user, self.password, device_name="ultima-py")
            if not getattr(reg, "access_token", None):
                raise RuntimeError(f"login e registro falharam: {resp.message} / {reg}")
        server = self.user_id.split(":", 1)[1]
        self.bot = self.bot or f"@ultima:{server}"
        r = await self.client.join(f"#ultima:{server}")
        self.lobby = getattr(r, "room_id", None)
        await self.sync(timeout=0)

    async def sync(self, timeout: int = 30000) -> None:
        resp = await self.client.sync(timeout=timeout, full_state=self.client.next_batch is None)
        if not isinstance(resp, SyncResponse):
            return
        for rid, info in resp.rooms.join.items():
            for ev in list(info.state) + list(info.timeline.events):
                self._apply(rid, getattr(ev, "source", {}) or {})
        for rid, info in resp.rooms.invite.items():
            for ev in info.invite_state:
                src = getattr(ev, "source", {}) or {}
                if src.get("type") == "m.room.member" and src.get("state_key") == self.user_id and src.get("sender") == self.bot:
                    await self.client.join(rid)
        self.changed.set()

    def _apply(self, rid: str, ev: dict) -> None:
        t, c, sender = ev.get("type"), ev.get("content", {}), ev.get("sender")
        if "state_key" in ev and t in (P.STATE, P.HAND, P.LOBBY):
            if sender != self.bot:
                return  # estado forjado por outro usuário: ignorado
            if t == P.STATE:
                self.games[rid] = c
            elif t == P.HAND:
                self.hands[ev["state_key"]] = c
            else:
                self.lobby_games = c.get("games", [])
        elif t == "m.room.message":
            self.messages.append((rid, sender, c.get("body", "")))
            del self.messages[:-300]
        elif t == P.RESULT and sender == self.bot and c.get("sender") == self.user_id:
            self.results.append(c)

    async def sync_forever(self) -> None:
        while True:
            try:
                await self.sync()
            except Exception:
                await asyncio.sleep(2)

    async def wait(self, predicate, timeout: float = 20) -> None:
        async def loop():
            while not predicate():
                self.changed.clear()
                await self.changed.wait()
        await asyncio.wait_for(loop(), timeout)

    # ---------------------------------------------------------------- ações
    async def send_move(self, room_id: str, action: str, seq: int | None = None, **extra) -> str:
        content = {"action": action, "game_id": room_id, **{k: v for k, v in extra.items() if v is not None}}
        if seq is not None:
            content["seq"] = seq
        r = await self.client.room_send(room_id, P.MOVE, content)
        return getattr(r, "event_id", "")

    async def move(self, room_id: str, action: str, **extra) -> str:
        st = self.games.get(room_id)
        return await self.send_move(room_id, action, st["seq"] if st else None, **extra)

    async def create_game(self) -> str:
        known = set(self.games)
        await self.send_move(self.lobby, "create")
        await self.wait(lambda: any(r not in known and g.get("owner") == self.user_id for r, g in self.games.items()))
        return next(r for r, g in self.games.items() if r not in known and g.get("owner") == self.user_id)

    async def join_game(self, room_id: str) -> None:
        if room_id not in self.games:
            await self.client.join(room_id)
        await self.move(room_id, "join")

    async def say(self, room_id: str, text: str) -> None:
        await self.client.room_send(room_id, "m.room.message", {"msgtype": "m.text", "body": text})

    async def close(self) -> None:
        await self.client.close()
