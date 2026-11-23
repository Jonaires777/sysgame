"""Ponto de entrada do bot árbitro: monta as camadas (composition root) e roda.

  python -m ultima          (configuração por variáveis de ambiente, ver README)
"""
from __future__ import annotations

import asyncio
import logging
import os

from .adapters.json_store import JsonStore
from .adapters.matrix_bot import MatrixBot, MatrixNotifier, build_client
from .application.service import GameService


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    logging.getLogger("nio").setLevel(logging.WARNING)

    homeserver = os.environ.get("HOMESERVER", "http://localhost:8008")
    user = os.environ.get("BOT_USER", "ultima")
    password = os.environ.get("BOT_PASSWORD", "ultima-bot-senha")
    turn_timeout = float(os.environ.get("TURN_TIMEOUT", "90"))
    max_timeouts = int(os.environ.get("MAX_TIMEOUTS", "3"))
    data_dir = os.environ.get("DATA_DIR", "data")
    lobby_alias = os.environ.get("LOBBY_ALIAS", "ultima")

    store = JsonStore(os.path.join(data_dir, "bot-state.json")).load()
    client = build_client(homeserver, user)
    notifier = MatrixNotifier(client, store, turn_timeout)                 # porta de saída -> Matrix
    service = GameService(store, notifier, turn_timeout, max_timeouts)      # casos de uso
    bot = MatrixBot(client, store, service, notifier, user, password, lobby_alias)  # porta de entrada
    try:
        await bot.run()
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
