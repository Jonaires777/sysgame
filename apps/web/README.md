# Última Carta — cliente web

React 19 + Vite + TypeScript + Tailwind CSS v4 + motion (animações) + lucide-react (ícones).
O cliente fala direto com o homeserver pela API Client-Server do Matrix; não há back-end próprio.

## Desenvolvimento

Com o homeserver e o bot rodando (na raiz do repositório: `docker compose up synapse bot`):

```bash
npm install
npm run dev        # http://localhost:5173 (também na rede: http://<IP>:5173)
```

O homeserver padrão é `http://<host-da-página>:8008` e pode ser trocado na tela de login (em "Servidor")
ou pela URL: `?hs=http://outro-host:8008`. O bot esperado é `@ultima:<servidor>` (troque com `?bot=@id:servidor`).

## Build

```bash
npm run build      # tsc + vite build -> dist/
npm run preview    # serve o dist/ em http://localhost:8080
```

Imagem Docker: `Dockerfile` (build com Node, servido por nginx na porta 8080).

## Estrutura

```
src/
  infra/matrix/client.ts   cliente HTTP da API Client-Server (login, registro, sync, send, join) — sem React
  domain/protocol.ts       tipos do protocolo (GameState, Hand, LobbyGame, Move) e tipos de evento
  domain/cards.ts          cartas: elemento, valor, rótulos, ordenação da mão
  store/store.ts           estado da aplicação fora do React (sync, eventos, ações) + hook useStore
  store/storage.ts         localStorage protegido por try/catch
  ui/components/           Card, HandView, Table, Players, TurnTimer, ColorPicker, Chat, Toast, ...
  ui/pages/                LoginPage, LobbyPage, GamePage
  App.tsx                  escolhe a página pela view atual
```

Fluxo: `infra` ← `store` ← `ui`. A UI só lê o estado com `useStore()` e chama ações do store; o store usa o
cliente Matrix e as regras de domínio. Estado, mão e lobby só são aceitos quando enviados pelo bot árbitro.
