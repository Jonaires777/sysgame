import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Check, Hand as HandIcon, LoaderCircle, LogOut, Megaphone, MessageCircle, Play, SkipForward, Swords, Trophy, X } from "lucide-react";
import { isWild } from "../../domain/cards";
import { short, type ColorCode } from "../../domain/protocol";
import {
  backToLobby, botId, me, move, playCard, selectGame, selectHand, sendChat, setLastCardArmed, useStore,
} from "../../store/store";
import { Button } from "../components/Button";
import { Celebration } from "../components/Celebration";
import { Chat } from "../components/Chat";
import { ColorPicker } from "../components/ColorPicker";
import { HandView } from "../components/HandView";
import { Players } from "../components/Players";
import { Table } from "../components/Table";
import { TurnTimer } from "../components/TurnTimer";

export function GamePage() {
  const s = useStore();
  const [wildCard, setWildCard] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const user = me(s);
  const rid = s.gameId;
  const room = rid ? s.rooms[rid] : undefined;
  const gs = selectGame(s, rid);
  const handForReset = gs && user && gs.players.includes(user) ? selectHand(s, rid) : null;
  const twoCardsNow = !!gs && gs.status === "playing" && gs.current === user && handForReset?.cards.length === 2;
  // o aviso "Última carta" só vale enquanto for a sua vez com 2 cartas
  useEffect(() => {
    if (!twoCardsNow && s.lastCardArmed) setLastCardArmed(false);
  }, [twoCardsNow, s.lastCardArmed]);

  if (!gs) {
    return (
      <div className="grid place-items-center gap-3 py-24 text-slate-400">
        <LoaderCircle className="animate-spin" /> Carregando a partida…
        <Button variant="ghost" onClick={backToLobby}><ArrowLeft size={16} /> Partidas</Button>
      </div>
    );
  }

  const mine = !!user && gs.players.includes(user);
  const myTurn = gs.status === "playing" && gs.current === user;
  const hand = mine ? selectHand(s, rid) : null;
  const fresh = !!hand && hand.seq === gs.seq; // mão correspondente ao estado atual da mesa
  const playable = new Set(myTurn && fresh ? hand!.playable : []);
  const twoCards = myTurn && hand?.cards.length === 2;
  const canDraw = myTurn && !gs.has_drawn;

  const onPlay = (card: string) => {
    if (isWild(card)) setWildCard(card);
    else void playCard(card, null, hand?.cards.length ?? 0);
  };
  const onPickColor = (c: ColorCode) => {
    const card = wildCard;
    setWildCard(null);
    if (card) void playCard(card, c, hand?.cards.length ?? 0);
  };

  let banner: { text: string; tone: "turn" | "warn" | "info" | "win" } = { text: "", tone: "info" };
  if (gs.status === "lobby") banner = { text: `Aguardando jogadores (${gs.players.length}/8) — mínimo de 2 para começar`, tone: "info" };
  else if (gs.status === "finished") banner = { text: gs.winner === user ? "Você venceu!" : `${short(gs.winner)} venceu!`, tone: "win" };
  else if (twoCards && !s.lastCardArmed && !gs.has_drawn) banner = { text: "Sua vez! Você tem 2 cartas: aperte Última carta! antes de jogar", tone: "warn" };
  else if (myTurn) banner = { text: gs.has_drawn ? "Sua vez: jogue a carta comprada ou passe" : "Sua vez!", tone: "turn" };
  else banner = { text: `Vez de ${short(gs.current)}`, tone: "info" };

  const bannerClass = {
    turn: "bg-gradient-to-r from-gold-300 to-gold-500 text-ink-950 shadow-lg shadow-gold-500/30",
    warn: "bg-fogo-600 text-white shadow-lg shadow-fogo-600/30",
    win: "bg-gradient-to-r from-gold-300 to-gold-500 text-ink-950",
    info: "bg-white/8 text-slate-200 ring-1 ring-white/10",
  }[banner.tone];

  const chat = <Chat messages={room?.messages ?? []} bot={botId(s)} onSend={sendChat} className="h-full" />;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <section className="min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={backToLobby}><ArrowLeft size={16} /> Partidas</Button>
          <h1 className="truncate text-lg font-extrabold">{gs.name || room?.name || "Partida"}</h1>
          <div className="flex items-center gap-1">
            <span className="hidden rounded-full bg-white/5 px-2 py-0.5 text-[11px] tabular-nums text-slate-400 sm:inline">estado #{gs.seq}</span>
            <button onClick={() => setChatOpen(true)} className="relative rounded-xl p-2 text-slate-300 hover:bg-white/8 lg:hidden" title="Mesa e chat">
              <MessageCircle size={20} />
            </button>
          </div>
        </div>

        <Players gs={gs} me={user} />
        <Table gs={gs} canDraw={canDraw} onDraw={() => void move("draw")} />

        <AnimatePresence mode="wait">
          <motion.div
            key={banner.text}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            className={`mx-auto flex w-fit max-w-full items-center gap-2 rounded-2xl px-4 py-2 text-center text-sm font-extrabold ${bannerClass}`}
          >
            {banner.tone === "win" ? <Trophy size={16} /> : banner.tone === "turn" ? <HandIcon size={16} /> : banner.tone === "warn" ? <Megaphone size={16} /> : null}
            {banner.text}
          </motion.div>
        </AnimatePresence>

        <TurnTimer gs={gs} me={user} />

        <div className="flex flex-wrap items-center justify-center gap-2">
          {gs.status === "lobby" && !mine && (
            <Button variant="primary" size="lg" onClick={() => void move("join")}><Swords size={18} /> Entrar na partida</Button>
          )}
          {gs.status === "lobby" && mine && (
            <>
              <Button variant="primary" size="lg" disabled={gs.players.length < 2} onClick={() => void move("start")}><Play size={18} /> Iniciar partida</Button>
              <Button size="lg" onClick={() => void move("leave")}><LogOut size={18} /> Sair</Button>
            </>
          )}
          {gs.status === "playing" && mine && (
            <>
              <Button size="lg" disabled={!canDraw} onClick={() => void move("draw")}>Comprar</Button>
              <Button size="lg" disabled={!myTurn || !gs.has_drawn} onClick={() => void move("pass")}><SkipForward size={18} /> Passar</Button>
              {twoCards && (
                <Button
                  size="lg"
                  variant={s.lastCardArmed ? "secondary" : "danger"}
                  className={s.lastCardArmed ? "!bg-terra-600 !text-white !ring-terra-400" : "animate-pulse-ring"}
                  onClick={() => setLastCardArmed(!s.lastCardArmed)}
                >
                  {s.lastCardArmed ? <><Check size={18} /> Última carta avisada!</> : <><Megaphone size={18} /> Última carta!</>}
                </Button>
              )}
            </>
          )}
          {gs.status === "finished" && (
            <Button variant="primary" size="lg" onClick={backToLobby}>Voltar às partidas</Button>
          )}
        </div>

        {mine && gs.status === "playing" && (
          hand ? (
            <HandView cards={hand.cards} playable={playable} myTurn={myTurn} onPlay={onPlay} />
          ) : (
            <p className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400"><LoaderCircle size={16} className="animate-spin" /> Recebendo suas cartas…</p>
          )
        )}
        {!mine && gs.status !== "lobby" && (
          <p className="py-4 text-center text-sm text-slate-400">Você está assistindo esta partida.</p>
        )}
      </section>

      {/* chat lateral no desktop */}
      <aside className="glass hidden h-[calc(100vh-7rem)] flex-col p-4 lg:sticky lg:top-20 lg:flex">
        <h3 className="mb-3 flex items-center gap-2 font-extrabold"><MessageCircle size={16} className="text-gold-400" /> Mesa e chat</h3>
        {chat}
      </aside>

      {/* chat em gaveta no celular */}
      <AnimatePresence>
        {chatOpen && (
          <motion.div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setChatOpen(false)}>
            <motion.div
              className="glass absolute inset-x-0 bottom-0 flex h-[75vh] flex-col rounded-b-none p-4"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 300, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-extrabold"><MessageCircle size={16} className="text-gold-400" /> Mesa e chat</h3>
                <button onClick={() => setChatOpen(false)} className="rounded-xl p-1.5 hover:bg-white/8"><X size={20} /></button>
              </div>
              {chat}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ColorPicker open={!!wildCard} onPick={onPickColor} onCancel={() => setWildCard(null)} />
      {gs.status === "finished" && gs.winner === user && <Celebration />}
    </div>
  );
}
