# Arquitetura do Última Carta

## Visão geral

```
                    ┌──────────────────────── Synapse (homeserver Matrix) ────────────────────────┐
 apps/web  ──HTTP──▶│  lobby #ultima   ·   sala de cada partida   ·   sala privada bot↔jogador     │◀──/sync── apps/server
 (React)            │  (log durável e replicado de eventos; contas; permissões das salas)          │           (bot árbitro)
 Element  ──HTTP──▶ └──────────────────────────────────────────────────────────────────────────────┘
```

O repositório é um **monorepo**:

| Pasta | O quê |
|---|---|
| `apps/server` | Bot árbitro em Python (matrix-nio), arquitetura hexagonal, testes e scripts de demonstração |
| `apps/web` | Cliente web em React + Vite + Tailwind + Motion |
| `infra` | Configuração extra do Synapse (registro aberto, limites de taxa) |
| `docs` | Proposta e este documento |

Os dois apps não importam código um do outro: o **contrato** entre eles é o protocolo de eventos Matrix
(`br.ufc.sysgame.*`), descrito abaixo e implementado em `apps/server/ultima/protocol.py` e
`apps/web/src/domain/`.

## Servidor: arquitetura hexagonal (portas e adaptadores)

```
              adaptador de ENTRADA                    núcleo                         adaptadores de SAÍDA
   ┌────────────────────────────────┐   ┌──────────────────────────────────┐   ┌──────────────────────────────┐
   │ MatrixBot                      │   │ application/service.py           │   │ MatrixNotifier (GameNotifier)│
   │  /sync → texto, evento         │──▶│  GameService (casos de uso)       │──▶│  state events, mãos, avisos  │
   │  personalizado, saída de membro│   │   idempotência · seq · timeouts  │   ├──────────────────────────────┤
   │  → protocol.Move               │   │ application/ports.py (interfaces)│──▶│ JsonStore (GameRepository)   │
   └────────────────────────────────┘   │ domain/ engine.py, cards.py      │   │  JSON com escrita atômica    │
                                        │  regras puras, sem I/O           │   └──────────────────────────────┘
                                        └──────────────────────────────────┘
```

- **Domínio** (`ultima/domain`): cartas, baralho e regras (`Game`). Python puro, determinístico com semente.
- **Aplicação** (`ultima/application`): `GameService` com os casos de uso — processar jogada, criar partida,
  verificar timeouts — e as **portas** `GameRepository` e `GameNotifier`. Não conhece Matrix nem disco.
- **Adaptadores** (`ultima/adapters`): `MatrixBot` (entrada), `MatrixNotifier` e `JsonStore` (saída).
- **Composition root** (`ultima/__main__.py`): lê a configuração e liga as peças.
- **Cliente Python** (`ultima/client/player.py`): usado pelo simulador e pelas demos.

Ganho prático: os casos de uso são testados com adaptadores falsos em memória
(`tests/test_service.py`), sem homeserver — inclusive jogadas concorrentes e reentrega de eventos.

## Cliente web: camadas

| Camada | Pasta | Responsabilidade |
|---|---|---|
| Infraestrutura | `src/infra/matrix` | Cliente HTTP da API Client-Server (login, registro, sync, envio) |
| Domínio | `src/domain` | Tipos do protocolo, constantes de eventos, helpers de carta |
| Estado | `src/store` | Réplica local do estado (salas, sessão), fora do React; `useSyncExternalStore` |
| Interface | `src/ui` | Páginas (login, lobby, partida) e componentes (carta, mão, mesa, timer...) |

## Protocolo

| Evento | Tipo | Quem envia | Conteúdo |
|---|---|---|---|
| `br.ufc.sysgame.move` | timeline | jogador | `action` (`create`, `join`, `leave`, `start`, `play`, `draw`, `pass`), `card`, `color`, `last_card`, `seq` |
| `br.ufc.sysgame.state` | state (`""`) | só o bot | estado público: jogadores, contagem de cartas, topo, cor, vez, sentido, `seq`, log, `turn_deadline` |
| `br.ufc.sysgame.hand` | state (`game_id`) na sala privada | só o bot | cartas do jogador, jogáveis agora, `seq` |
| `br.ufc.sysgame.result` | timeline | bot | `in_reply_to`, `ok`, `reason`, `seq` |
| `br.ufc.sysgame.lobby` | state (`""`) no lobby | só o bot | partidas abertas |

Comandos de texto equivalentes (`!jogar F7`, `!comprar`...) permitem jogar por qualquer cliente Matrix.

### Fluxo de uma jogada

1. O cliente envia `move` com o `seq` do estado que está vendo.
2. O Synapse grava o evento na timeline da sala (log durável).
3. O bot recebe o evento pelo `/sync` (na ordem da timeline do seu homeserver) e chama `GameService.handle`.
4. O serviço descarta eventos já vistos, confere `seq` e vez, aplica a regra no domínio.
5. O notifier publica o novo `state`, o `result` e as mãos que mudaram.
6. Os clientes recebem o novo estado pelo `/sync` e redesenham.

## Conceitos de Sistemas Distribuídos

| Conceito | Onde aparece |
|---|---|
| **Ordenação** | O Matrix guarda os eventos de uma sala num DAG; com federação, servidores podem ver eventos concorrentes em ordens diferentes. O bot é um **sequenciador único**: vale a ordem da timeline do homeserver dele, e cada jogada aceita incrementa `seq` (ordem total). |
| **Concorrência** | Controle **otimista**: a jogada carrega o `seq` em que foi pensada; se o estado mudou, é rejeitada. Demo: `scripts/concorrencia.py`. |
| **Idempotência** | `PUT /send/{txnId}` deduplica retransmissões no homeserver; o serviço deduplica por `event_id` (reentrega após queda). |
| **Tolerância a falhas** | O homeserver é o log durável. O bot salva estado e *sync token* (escrita atômica) e, ao voltar, processa as jogadas pendentes: entrega "pelo menos uma vez" + deduplicação = efeito "exatamente uma vez". Demo: `scripts/queda_bot.py`. |
| **Detecção de falhas** | Timeout de turno: no modelo assíncrono não dá para distinguir jogador lento de caído; após `MAX_TIMEOUTS` seguidos, o jogador é removido. |
| **Replicação** | O estado público é um *state event*: o homeserver replica para todos os membros; quem reconecta recupera a mesa lendo o estado atual. |
| **Segurança** | *Power levels*: só o bot escreve `state`, `hand` e `lobby` (testado: jogador recebe `M_FORBIDDEN`); clientes ignoram estado de outro remetente. Limitações: sem E2EE (o admin do homeserver lê as mãos) e registro aberto (só para rede local). |
| **Escalabilidade** | Cada partida é independente (uma sala); o gargalo é o bot único. Evolução possível: vários bots, cada um responsável por um conjunto de salas (particionamento). |
