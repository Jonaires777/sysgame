// Cliente web do Última Carta: fala direto com o homeserver pela API Client-Server do Matrix.
// O bot árbitro é a única fonte de verdade: só aceitamos estado/mão enviados por ele.
"use strict";

const NS = "br.ufc.sysgame";
const EV = { MOVE: `${NS}.move`, STATE: `${NS}.state`, HAND: `${NS}.hand`, RESULT: `${NS}.result`, LOBBY: `${NS}.lobby` };
const COLOR_NAMES = { F: "Fogo", A: "Água", T: "Terra", V: "Vento" };
const params = new URLSearchParams(location.search);

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : String(k));
  return e;
};
const short = (u) => (u || "").replace(/^@/, "").split(":")[0];

function storage(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { return null; }
}

// ---------------------------------------------------------------- estado do cliente
const S = {
  hs: storage("hs") || params.get("hs") || `${location.protocol}//${location.hostname}:8008`,
  session: storage("session"),       // {user_id, access_token}
  since: null,
  rooms: {},                         // room_id -> {name, state:{type|key: content}, messages:[]}
  lobbyId: null,
  view: "login",
  gameId: null,
  pendingCreate: false,
  lastLiveSync: false,
  txn: 0,
};
const me = () => S.session?.user_id;
const server = () => me()?.split(":").slice(1).join(":");
const botId = () => params.get("bot") || `@ultima:${server()}`;

// ---------------------------------------------------------------- API Matrix
async function api(method, path, body, { auth = true, query } = {}) {
  const url = new URL(`${S.hs}/_matrix/client/v3${path}`);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
  const headers = { "Content-Type": "application/json" };
  if (auth && S.session) headers.Authorization = `Bearer ${S.session.access_token}`;
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || `HTTP ${r.status}`);
    Object.assign(err, { status: r.status, data });
    throw err;
  }
  return data;
}

async function login(user, password) {
  return api("POST", "/login", {
    type: "m.login.password", identifier: { type: "m.id.user", user }, password,
    initial_device_display_name: "Última Carta (web)",
  }, { auth: false });
}

async function register(username, password) {
  const body = { username, password, initial_device_display_name: "Última Carta (web)" };
  try {
    return await api("POST", "/register", body, { auth: false });
  } catch (e) {
    // autenticação interativa: o servidor devolve 401 com uma sessão; completamos com m.login.dummy
    if (e.status !== 401 || !e.data.session) throw e;
    return api("POST", "/register", { ...body, auth: { type: "m.login.dummy", session: e.data.session } }, { auth: false });
  }
}

const enc = encodeURIComponent;
const send = (roomId, type, content) =>
  api("PUT", `/rooms/${enc(roomId)}/send/${enc(type)}/${Date.now()}-${S.txn++}`, content);
const join = (idOrAlias) => api("POST", `/join/${enc(idOrAlias)}`, {});

// ---------------------------------------------------------------- sync
const FILTER = JSON.stringify({ room: { timeline: { limit: 40 } }, presence: { types: [] } });

async function syncLoop() {
  while (S.session) {
    try {
      const data = await api("GET", "/sync", null, { query: { since: S.since, timeout: S.since ? 30000 : 0, filter: FILTER } });
      const live = S.since != null;
      S.since = data.next_batch;
      processSync(data, live);
      render();
    } catch (e) {
      if (e.status === 401) return logout("Sessão expirada, entre de novo.");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

function room(id) {
  return (S.rooms[id] ||= { name: "", state: {}, messages: [] });
}

function processSync(data, live) {
  const rooms = data.rooms || {};
  for (const [rid, r] of Object.entries(rooms.join || {})) {
    const R = room(rid);
    for (const ev of r.state?.events || []) applyEvent(R, rid, ev, false);
    for (const ev of r.timeline?.events || []) applyEvent(R, rid, ev, live);
  }
  // convites do bot (sala da partida e sala privada das cartas) são aceitos automaticamente
  for (const [rid, r] of Object.entries(rooms.invite || {})) {
    const inv = (r.invite_state?.events || []).find((e) => e.type === "m.room.member" && e.state_key === me());
    if (inv?.sender === botId()) join(rid).catch(() => {});
  }
  for (const rid of Object.keys(rooms.leave || {})) delete S.rooms[rid];
}

function applyEvent(R, rid, ev, live) {
  if (ev.type === "m.room.name") R.name = ev.content.name;
  const fromBot = ev.sender === botId();
  if (ev.state_key !== undefined && [EV.STATE, EV.HAND, EV.LOBBY].includes(ev.type)) {
    if (!fromBot) return; // segurança: ignora estado forjado por qualquer outro usuário
    R.state[`${ev.type}|${ev.state_key}`] = ev.content;
    if (ev.type === EV.STATE && S.pendingCreate && ev.content.owner === me() && ev.content.status === "lobby") {
      S.pendingCreate = false;
      openGame(rid);
    }
    return;
  }
  if (ev.type === "m.room.message") {
    R.messages.push({ sender: ev.sender, body: ev.content.body || "", notice: ev.content.msgtype === "m.notice" });
    if (R.messages.length > 200) R.messages.splice(0, R.messages.length - 200);
  }
  if (ev.type === EV.RESULT && fromBot && live && ev.content.sender === me() && !ev.content.ok) {
    toast(ev.content.reason);
  }
}

const gameState = (rid) => S.rooms[rid]?.state[`${EV.STATE}|`];
function myHand(gameId) {
  for (const R of Object.values(S.rooms)) {
    const h = R.state[`${EV.HAND}|${gameId}`];
    if (h) return h;
  }
  return null;
}

// ---------------------------------------------------------------- ações
async function move(action, extra = {}) {
  const st = gameState(S.gameId);
  try {
    await send(S.gameId, EV.MOVE, { action, game_id: S.gameId, seq: st?.seq ?? null, ...extra });
  } catch (e) {
    toast(`Falha ao enviar: ${e.message}`);
  }
}

async function enterLobby() {
  const alias = `#ultima:${server()}`;
  for (;;) {
    try {
      const r = await join(alias);
      S.lobbyId = r.room_id;
      $("lobby-status").textContent = "";
      return;
    } catch (e) {
      $("lobby-status").textContent = `Aguardando o bot criar o lobby ${alias}… (${e.message})`;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function openGame(rid) {
  S.gameId = rid;
  S.view = "game";
  if (!S.rooms[rid]) {
    try { await join(rid); } catch (e) { return toast(`Não consegui entrar na sala: ${e.message}`); }
  }
  render();
}

function newGame() {
  if (!S.lobbyId) return;
  S.pendingCreate = true;
  send(S.lobbyId, EV.MOVE, { action: "create" }).catch((e) => toast(e.message));
  toast("Criando partida…", "info");
}

// ---------------------------------------------------------------- UI
let toastTimer;
function toast(msg, kind = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 3500);
}

function cardEl(code, { big = false, chosen = null, onclick, ok } = {}) {
  const wild = code === "C" || code === "C+4";
  const color = wild ? "W" : code[0];
  const v = wild ? (code === "C" ? "★" : "+4") : code.slice(1);
  const label = { B: "⦸", I: "⇄" }[v] || v;
  const cls = ["card", color, big && "big", chosen && `chosen-${chosen}`, ok && "ok"].filter(Boolean).join(" ");
  return el("div", { class: cls, title: code, onclick }, el("span", { class: "corner" }, label), label);
}

function render() {
  for (const v of ["login", "lobby", "game"]) $(`view-${v}`).classList.toggle("hidden", S.view !== v);
  $("who").replaceChildren(
    ...(me() ? [el("span", {}, short(me())), el("button", { class: "ghost", onclick: () => logout() }, "Sair")] : []));
  if (S.view === "lobby") renderLobby();
  if (S.view === "game") renderGame();
}

function renderLobby() {
  const lobby = S.lobbyId && S.rooms[S.lobbyId]?.state[`${EV.LOBBY}|`];
  const games = (lobby?.games || []).slice().reverse();
  $("btn-new").disabled = !S.lobbyId;
  $("games").replaceChildren(...(games.length ? games.map((g) => {
    const inGame = g.players.includes(me());
    const label = inGame ? "Voltar" : g.status === "lobby" ? "Entrar" : "Assistir";
    return el("li", {},
      el("div", {},
        el("b", {}, g.name || "Partida"), " ",
        el("span", { class: `tag ${g.status}` }, g.status === "lobby" ? "aguardando" : "em jogo"),
        el("div", { class: "muted small" }, `${g.players.length} jogador(es): ${g.players.map(short).join(", ")}`)),
      el("button", { class: inGame || g.status === "lobby" ? "primary" : "", onclick: () => openGame(g.room_id) }, label));
  }) : [el("li", { class: "muted" }, S.lobbyId ? "Nenhuma partida aberta. Crie uma!" : "Conectando…")]));
}

function renderGame() {
  const rid = S.gameId;
  const R = S.rooms[rid];
  const st = gameState(rid);
  $("g-name").textContent = st?.name || R?.name || "Partida";
  $("g-seq").textContent = st ? `estado #${st.seq}` : "";
  if (!st) {
    $("g-banner").textContent = "Carregando a partida…";
    return;
  }
  const mine = st.players.includes(me());
  const myTurn = st.status === "playing" && st.current === me();
  const hand = mine ? myHand(rid) : null;
  const fresh = hand && hand.seq === st.seq; // mão correspondente ao estado atual da mesa

  $("g-players").replaceChildren(...st.players.map((p) => el("li", {
    class: [p === st.current && "turn", p === me() && "me"].filter(Boolean).join(" "),
  }, short(p), el("span", { class: "count" }, st.status === "lobby" ? "" : `🂠 ${st.hand_counts[p]}`),
    st.hand_counts[p] === 1 && st.status === "playing" ? el("span", { class: "last" }, "!") : null)));

  $("g-top").replaceChildren(st.top_card ? cardEl(st.top_card, { big: true, chosen: st.color })
    : el("div", { class: "card big back" }, el("span", {}, "?")));
  $("g-color").textContent = st.color ? `cor: ${COLOR_NAMES[st.color]}` : "";
  $("g-drawcount").textContent = st.status === "playing" ? `${st.draw_pile} no monte` : "";
  $("g-dir").textContent = st.status === "playing" ? (st.direction === 1 ? "↻" : "↺") : "";
  const drawPile = $("g-draw");
  drawPile.onclick = myTurn && !st.has_drawn ? () => move("draw") : null;
  drawPile.style.opacity = myTurn && !st.has_drawn ? 1 : 0.6;

  const banner = $("g-banner");
  banner.className = "banner" + (myTurn ? " myturn" : "");
  if (st.status === "lobby") banner.textContent = `Aguardando jogadores (${st.players.length}/8). Mínimo de 2 para começar.`;
  else if (st.status === "finished") banner.textContent = st.winner === me() ? "🏆 Você venceu!" : `🏆 ${short(st.winner)} venceu!`;
  else if (myTurn) banner.textContent = st.has_drawn ? "Sua vez: jogue a carta comprada ou passe." : "Sua vez!";
  else banner.textContent = `Vez de ${short(st.current)}`;

  // ações
  const acts = [];
  if (st.status === "lobby") {
    if (!mine) acts.push(el("button", { class: "primary", onclick: () => move("join") }, "Entrar na partida"));
    else {
      acts.push(el("button", { class: "primary", disabled: st.players.length < 2, onclick: () => move("start") }, "Iniciar partida"));
      acts.push(el("button", { onclick: () => move("leave") }, "Sair da partida"));
    }
  } else if (st.status === "playing" && mine) {
    acts.push(el("button", { disabled: !myTurn || st.has_drawn, onclick: () => move("draw") }, "Comprar"));
    acts.push(el("button", { disabled: !myTurn || !st.has_drawn, onclick: () => move("pass") }, "Passar"));
    const cb = el("input", { type: "checkbox", id: "last-card" });
    cb.checked = S.lastCard || false;
    cb.onchange = () => (S.lastCard = cb.checked);
    acts.push(el("label", { class: "check" }, cb, "Última carta!"));
  } else if (st.status === "finished") {
    acts.push(el("button", { class: "primary", onclick: () => { S.view = "lobby"; render(); } }, "Voltar às partidas"));
  }
  $("g-actions").replaceChildren(...acts);

  // mão
  const playable = new Set(myTurn && fresh ? hand.playable : []);
  const handBox = $("g-hand");
  handBox.className = "hand" + (myTurn ? "" : " waiting");
  handBox.replaceChildren(...(hand?.cards || []).map((c) => cardEl(c, {
    ok: playable.has(c),
    onclick: playable.has(c) ? () => playCard(c, hand.cards.length) : null,
  })));
  if (mine && st.status === "playing" && !hand) handBox.replaceChildren(el("p", { class: "muted" }, "Recebendo suas cartas…"));

  // log/chat
  const log = $("g-log");
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
  log.replaceChildren(...(R?.messages || []).slice(-80).map((m) => el("li", { class: m.notice ? "notice" : "" },
    m.notice ? m.body : [el("b", {}, short(m.sender) + ": "), m.body])));
  if (atBottom) log.scrollTop = log.scrollHeight;
}

async function playCard(card, handSize) {
  let color = null;
  if (card === "C" || card === "C+4") {
    color = await pickColor();
    if (!color) return;
  }
  const last = handSize === 2 && S.lastCard;
  await move("play", { card, color, last_card: last });
  S.lastCard = false;
}

function pickColor() {
  const d = $("color-dialog");
  return new Promise((resolve) => {
    const handler = (e) => {
      if (e.target.tagName !== "BUTTON") return;
      d.removeEventListener("click", handler);
      d.close();
      resolve(e.target.value || null);
    };
    d.addEventListener("click", handler);
    d.showModal();
  });
}

// ---------------------------------------------------------------- sessão
async function start() {
  S.view = "lobby";
  render();
  syncLoop();
  await enterLobby();
  render();
}

function logout(msg) {
  storage("session", null);
  S.session = null;
  S.since = null;
  S.rooms = {};
  S.lobbyId = null;
  S.view = "login";
  render();
  if (msg) toast(msg);
}

$("lg-hs").value = S.hs;
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const mode = e.submitter?.dataset.mode || "login";
  const user = $("lg-user").value.trim().toLowerCase();
  const pass = $("lg-pass").value;
  S.hs = $("lg-hs").value.trim().replace(/\/$/, "");
  $("lg-err").textContent = "";
  try {
    const r = mode === "register" ? await register(user, pass) : await login(user, pass);
    S.session = { user_id: r.user_id, access_token: r.access_token };
    storage("session", S.session);
    storage("hs", S.hs);
    start();
  } catch (err) {
    const msg = { M_USER_IN_USE: "esse nome já existe; use Entrar", M_FORBIDDEN: "usuário ou senha incorretos" }[err.data?.errcode];
    $("lg-err").textContent = msg || err.message || "não consegui falar com o homeserver";
  }
});
$("btn-new").onclick = newGame;
$("btn-back").onclick = () => { S.view = "lobby"; render(); };
$("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const body = $("chat-input").value.trim();
  if (!body || !S.gameId) return;
  send(S.gameId, "m.room.message", { msgtype: "m.text", body }).catch((err) => toast(err.message));
  $("chat-input").value = "";
});

if (S.session) start(); else render();
