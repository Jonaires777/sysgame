# Última Carta — jogo de cartas multiplayer sobre Matrix

Trabalho de Sistemas Distribuídos (graduação) — Prof. Paulo A. L. Rego. Aplicação distribuída construída sobre o
[protocolo Matrix](https://spec.matrix.org): um jogo de cartas por turnos, no estilo "descarte" (combinar cor ou valor
com a carta da mesa), em que **as jogadas são eventos personalizados numa sala Matrix** e um **bot árbitro** ordena e
valida as jogadas. Acompanhamento na issue #14.

## Início rápido

Requisito: Docker (com Docker Compose).

```bash
docker compose up --build
```

Abra **http://localhost:8080**, crie uma conta (nome + senha), clique em **Nova partida** e chame os amigos.

- **Jogadores de outras máquinas da mesma rede:** abram `http://<IP-desta-máquina>:8080`. O cliente web usa o
  homeserver no mesmo host, porta 8008. Pode ser preciso liberar as portas 8008 e 8080 no firewall da máquina.
- **Completar a mesa com robôs:** `docker compose run --rm robos --entrar '<room_id da partida>' --jogadores 2`
  (o `room_id` aparece no chat da partida). Sem `--entrar`, 3 robôs jogam uma partida inteira entre si.
- **Logs do bot:** `docker compose logs -f bot`
- **Parar:** `docker compose down` (mantém contas e partidas). `docker compose down -v` apaga tudo.

## Arquitetura

```
 Navegador (cliente web)  ──┐                                   ┌── Bot árbitro (Python, matrix-nio)
 Robôs / scripts (nio)    ──┼── API Client-Server do Matrix ── Synapse ──┤   valida, ordena e publica o estado
 Element (comandos !texto)──┘            (HTTP :8008)            └── volume: bot-state.json
```

| Componente | O que faz |
|---|---|
| **Synapse** (homeserver) | Guarda e distribui os eventos das salas; contas dos jogadores |
| **Bot árbitro** (`apps/server`) | Única autoridade: baralho, mãos, validação das jogadas, estado público. Arquitetura hexagonal: domínio → casos de uso → adaptadores Matrix e JSON |
| **Cliente web** (`apps/web`) | React + Vite + Tailwind + Motion; fala direto com o homeserver |
| **Simulador** (`apps/server/scripts`) | Jogadores automáticos e demos de concorrência e de queda do bot |

Detalhes das camadas, do protocolo e dos conceitos em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

### Salas e eventos

| Sala | Conteúdo |
|---|---|
| Lobby `#ultima:<servidor>` | Comando de criar partida; state event `br.ufc.sysgame.lobby` com as partidas abertas |
| Uma sala por partida (criada pelo bot) | Jogadas `br.ufc.sysgame.move`; estado público `br.ufc.sysgame.state`; respostas `br.ufc.sysgame.result`; chat |
| Sala privada bot ↔ jogador | Mão do jogador: state event `br.ufc.sysgame.hand` (state_key = id da partida) |

Fluxo de uma jogada: o cliente envia `br.ufc.sysgame.move` com `{action, card, color, seq}` → o bot recebe pelo
`/sync`, confere remetente, vez e `seq`, aplica no motor → publica o novo `br.ufc.sysgame.state`, um
`br.ufc.sysgame.result` e atualiza as mãos nas salas privadas.

### Relação com os conceitos da disciplina

- **Ordenação:** o Matrix organiza os eventos de uma sala num grafo (DAG); servidores diferentes podem ver eventos
  concorrentes em ordens diferentes. Aqui o bot funciona como **sequenciador único**: vale a ordem em que as
  jogadas aparecem na timeline do homeserver do bot, e cada jogada aceita incrementa `seq`.
- **Jogadas concorrentes:** controle otimista. A jogada leva o `seq` do estado em que foi pensada; se o estado já
  mudou, o bot rejeita ("jogada desatualizada").
- **Tolerância a falhas:** o bot grava partidas e *sync token* em disco após cada lote. Se cair, as jogadas
  enviadas nesse intervalo ficam guardadas no homeserver e são processadas, em ordem, quando ele volta. Eventos
  reentregues são descartados pelo `event_id`.
- **Detecção de falha:** se o jogador da vez não age em `TURN_TIMEOUT` segundos, o bot compra e passa por ele; após
  `MAX_TIMEOUTS` seguidos, remove o jogador. O timeout não distingue jogador lento de jogador caído.
- **Replicação do estado:** o estado público é um *state event*, replicado pelo homeserver para todos os
  clientes; quem reconecta recupera a mesa só lendo o estado atual da sala.
- **Segurança:** os *power levels* das salas criadas pelo bot só permitem ao bot publicar o estado, e os clientes
  ignoram estado vindo de qualquer outro remetente. **Limitações:** as salas não usam criptografia de ponta a ponta
  (o administrador do homeserver consegue ler as mãos) e o registro é aberto, sem verificação — configuração só
  para demonstração em rede local.

### Demonstração de jogadas concorrentes

```bash
docker compose run --rm --entrypoint python robos scripts/concorrencia.py
```

Cria uma partida com 3 jogadores e roda três cenários, mostrando a ordem das jogadas na timeline e a decisão do bot:

1. **Mesmo jogador, duas jogadas sobre o mesmo estado** (dois dispositivos ou clique duplo): a primeira na
   timeline é aceita; a segunda é rejeitada como desatualizada (`seq` antigo).
2. **Os 3 jogadores jogam no mesmo instante:** só a jogada do jogador da vez é aceita.
3. **Retransmissão com o mesmo ID de transação:** o homeserver deduplica (o `PUT /send/{txnId}` do Matrix é
   idempotente) e devolve o mesmo `event_id`; o estado avança uma vez só.

Exemplo de saída:

```
1) Mesmo jogador, duas jogadas sobre o mesmo estado (dois dispositivos / clique duplo)
  ordem jogador     jogada          seq   resultado
  1     conc2       jogar F6        4     ACEITA
  2     conc2       comprar         4     rejeitada: jogada desatualizada (baseada no estado #4, atual #5); ...
```

### Demonstração de queda do bot (tolerância a falhas)

```bash
python apps/server/scripts/queda_bot.py   # na máquina hospedeira, com o sistema rodando (usa o comando docker)
```

Cria uma partida, mata o bot com `docker compose kill bot` (SIGKILL), faz o jogador da vez jogar com o bot fora,
mostra que o estado não muda e religa o bot. Saída obtida:

```
2) Matando o bot árbitro (SIGKILL)
3) Com o bot fora, queda1 envia 'jogar C' (baseada no estado #3)
   4 s depois o estado continua #3 — ninguém validou a jogada ainda
4) Religando o bot
   Em 4.9 s o bot voltou e aplicou a jogada pendente: estado #4
   Aplicada exatamente uma vez? SIM (esperado #4)
```

### Timeout de turno na demonstração

O padrão é 90 s por jogada. Para mostrar o timeout ao vivo sem esperar:

```bash
TURN_TIMEOUT=10 MAX_TIMEOUTS=2 docker compose up -d bot
```

## Regras do jogo

Baralho de 108 cartas em 4 cores — **F** Fogo, **A** Água, **T** Terra, **V** Vento — com números 0–9, **+2**,
**B** Bloqueio, **I** Inverte, mais **C** Coringa e **C+4** Coringa +4. Cada jogador começa com 7 cartas.

- Jogue uma carta da mesma cor ou do mesmo valor da carta da mesa; coringas valem sempre (você escolhe a cor).
- Bloqueio: o próximo perde a vez. Inverte: muda o sentido (com 2 jogadores, funciona como Bloqueio).
  +2 / +4: o próximo compra 2 / 4 e perde a vez.
- Sem jogada: compre 1 carta; você pode jogar a carta comprada, se servir, ou passar.
- Ao ficar com uma carta, avise "última carta" na jogada; quem esquecer compra 2.
- Vence quem esvaziar a mão.

### Comandos de texto

O bot também aceita comandos de texto na sala da partida, para quem usa outro cliente Matrix
(ex.: Element apontando para `http://localhost:8008`). Esse caminho ainda não foi testado com o Element.

```
!criar   !entrar   !sair   !iniciar   !jogar F7   !jogar C A   !jogar F7 ultima   !comprar   !passar   !mao   !estado   !ajuda
```

## Configuração

Tudo é opcional; copie `.env.example` para `.env` para mudar.

| Variável | Padrão | Efeito |
|---|---|---|
| `SERVER_NAME` | `localhost` | Nome do homeserver (IDs `@ana:localhost`). Mudar exige `docker compose down -v` |
| `BOT_PASSWORD` | `ultima-bot-senha` | Senha da conta do bot (criada automaticamente) |
| `TURN_TIMEOUT` | `90` | Segundos por jogada; `0` desliga |
| `MAX_TIMEOUTS` | `3` | Timeouts seguidos até remover o jogador |
| `BIND` | `0.0.0.0` | Interface das portas 8008/8080; `127.0.0.1` restringe à própria máquina |

**Limites de taxa do Synapse:** o padrão do Synapse permite criar só ~1 sala por minuto por usuário, e o bot cria
uma sala por partida e uma sala privada por jogador. Por isso `infra/synapse-extra.yaml` aumenta os limites. Esse
arquivo só é aplicado quando o volume do Synapse é criado; se o volume é de uma versão anterior deste repositório,
recrie com `docker compose down -v && docker compose up --build` (apaga contas e partidas).

## Desenvolvimento (sem Docker para o código)

O homeserver continua vindo do Docker: `docker compose up -d synapse`.

**Servidor** (Python 3.11+):

```bash
cd apps/server
python -m venv .venv
source .venv/Scripts/activate      # Windows (Git Bash); no Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt

pytest -q                          # domínio, protocolo e casos de uso (com adaptadores falsos)
HOMESERVER=http://localhost:8008 python -m ultima
HOMESERVER=http://localhost:8008 python scripts/simular.py
```

**Cliente web** (Node.js 20+): ver [`apps/web/README.md`](apps/web/README.md).

## Estrutura (monorepo)

```
apps/server/                  bot árbitro (Python)
  ultima/domain/              regras do jogo: cards.py, engine.py (puro, sem I/O)
  ultima/application/         casos de uso (service.py) e portas (ports.py)
  ultima/adapters/            Matrix (matrix_bot.py: entrada e saída) e persistência (json_store.py)
  ultima/client/              cliente de jogador em Python (simulador e demos)
  ultima/protocol.py          contrato: tipos de evento e comandos de texto
  ultima/__main__.py          composition root: liga as camadas e roda o bot
  tests/                      pytest
  scripts/                    simular.py, concorrencia.py, queda_bot.py
apps/web/                     cliente web (React + Vite + Tailwind + Motion)
infra/synapse-extra.yaml      configuração extra do Synapse
docs/                         proposta e arquitetura
docker-compose.yml            sobe tudo
```
