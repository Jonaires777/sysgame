import { motion } from "motion/react";
import { Ban, DoorOpen, Eye, Layers, LoaderCircle, Plus, Repeat, Sparkles, Swords, Users } from "lucide-react";
import { me, newGame, openGame, selectLobby, useStore } from "../../store/store";
import { short } from "../../domain/protocol";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { Card } from "../components/Card";

export function LobbyPage() {
  const s = useStore();
  const games = [...selectLobby(s)].reverse();
  const user = me(s);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <section>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Partidas</h1>
            <p className="text-sm text-slate-400">Crie uma mesa e chame os amigos, ou entre numa que está esperando.</p>
          </div>
          <Button variant="primary" size="lg" onClick={newGame} disabled={!s.lobbyId || s.pendingCreate}>
            {s.pendingCreate ? <LoaderCircle size={18} className="animate-spin" /> : <Plus size={18} />} Nova partida
          </Button>
        </div>

        {s.lobbyStatus && (
          <p className="mb-4 flex items-center gap-2 rounded-2xl bg-vento-600/15 px-4 py-3 text-sm text-vento-400 ring-1 ring-vento-600/30">
            <LoaderCircle size={16} className="animate-spin" /> {s.lobbyStatus}
          </p>
        )}

        {games.length === 0 ? (
          <div className="glass grid place-items-center gap-3 px-6 py-14 text-center">
            <div className="flex">
              <Card faceDown size="sm" style={{ rotate: -10 }} />
              <Card faceDown size="sm" className="-ml-6" style={{ rotate: 8 }} />
            </div>
            <p className="text-slate-400">{s.lobbyId ? "Nenhuma partida aberta. Crie a primeira!" : "Conectando ao lobby…"}</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {games.map((g, i) => {
              const inGame = !!user && g.players.includes(user);
              const waiting = g.status === "lobby";
              return (
                <motion.div
                  key={g.room_id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04 } }}
                  whileHover={{ y: -3 }}
                  className="glass flex flex-col gap-4 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-lg font-extrabold">{g.name || "Partida"}</div>
                      <div className="flex items-center gap-1 text-xs text-slate-400"><Users size={12} /> {g.players.length}/8 jogadores</div>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${waiting ? "bg-terra-600/25 text-terra-400 ring-1 ring-terra-600/40" : "bg-vento-600/20 text-vento-400 ring-1 ring-vento-600/40"}`}>
                      {waiting ? "aguardando" : "em jogo"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex -space-x-2">
                      {g.players.slice(0, 6).map((p) => <Avatar key={p} user={p} size={30} className="ring-ink-800" />)}
                    </div>
                    <Button size="sm" variant={inGame || waiting ? "primary" : "secondary"} onClick={() => void openGame(g.room_id)}>
                      {inGame ? <><DoorOpen size={15} /> Voltar</> : waiting ? <><Swords size={15} /> Entrar</> : <><Eye size={15} /> Assistir</>}
                    </Button>
                  </div>
                  <div className="truncate text-[11px] text-slate-500">{g.players.map(short).join(" · ")}</div>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      <aside className="glass h-fit p-5">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold"><Layers size={18} className="text-gold-400" /> Como jogar</h2>
        <ul className="space-y-3 text-sm text-slate-300">
          <li>Jogue uma carta do <b className="text-white">mesmo elemento</b> (cor) ou do <b className="text-white">mesmo valor</b> da carta da mesa.</li>
          <li className="flex gap-2"><Ban size={16} className="mt-0.5 shrink-0 text-fogo-400" /><span><b className="text-white">Bloqueio</b>: o próximo perde a vez.</span></li>
          <li className="flex gap-2"><Repeat size={16} className="mt-0.5 shrink-0 text-agua-400" /><span><b className="text-white">Inverte</b>: muda o sentido. <b className="text-white">+2</b>: o próximo compra 2 e perde a vez.</span></li>
          <li className="flex gap-2"><Sparkles size={16} className="mt-0.5 shrink-0 text-gold-300" /><span><b className="text-white">Coringa</b>: você escolhe o elemento. <b className="text-white">+4</b>: escolhe e o próximo compra 4.</span></li>
          <li>Sem jogada? <b className="text-white">Compre</b> uma carta: jogue-a, se servir, ou <b className="text-white">passe</b>.</li>
          <li>Com 2 cartas, aperte <b className="text-white">📢 Última carta!</b> antes de jogar, senão compra 2.</li>
          <li>Quem esvaziar a mão primeiro vence. 🏆</li>
        </ul>
        <div className="mt-5 flex justify-center">
          {["F5", "A5", "T5", "V5"].map((c, i) => (
            <Card key={c} code={c} size="sm" className={i ? "-ml-4" : ""} style={{ rotate: (i - 1.5) * 9 }} />
          ))}
        </div>
      </aside>
    </div>
  );
}
