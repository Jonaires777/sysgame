import { motion } from "motion/react";
import { Crown, Timer } from "lucide-react";
import { short, type GameState } from "../../domain/protocol";
import { Avatar } from "./Avatar";
import { Card } from "./Card";
import { timerTone, useTurnSeconds } from "./TurnTimer";

function Clock({ gs }: { gs: GameState }) {
  const t = useTurnSeconds(gs);
  if (!t) return null;
  const danger = timerTone(t.left, t.total) === "danger";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums ${danger ? "text-fogo-400" : "text-gold-300"}`}>
      <Timer size={11} />{Math.ceil(t.left)}s
    </span>
  );
}

/** Faixa de jogadores: avatar, nome, mini-leque de cartas e contagem. */
export function Players({ gs, me }: { gs: GameState; me: string | null }) {
  return (
    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-2">
      {gs.players.map((p) => {
        const count = gs.hand_counts[p] ?? 0;
        const turn = gs.status === "playing" && p === gs.current;
        const isMe = p === me;
        const fan = Math.min(count, 5);
        return (
          <motion.div
            key={p}
            layout
            animate={{ scale: turn ? 1.04 : 1 }}
            className={`relative flex min-w-[7.5rem] shrink-0 items-center gap-2.5 rounded-2xl px-3 py-2 ring-1 transition ${
              turn ? "bg-gold-400/15 ring-gold-400/70 shadow-[0_0_24px_rgb(252_201_75/0.25)]" : "bg-white/5 ring-white/10"
            }`}
          >
            <div className="relative">
              <Avatar user={p} size={36} />
              {gs.winner === p && <Crown size={18} className="absolute -right-2 -top-3 rotate-12 text-gold-400" fill="currentColor" />}
            </div>
            <div className="min-w-0">
              <div className={`truncate text-sm ${isMe ? "font-extrabold text-white" : "font-semibold text-slate-200"}`}>
                {short(p)}{isMe && <span className="ml-1 text-[10px] font-medium text-slate-400">(você)</span>}
              </div>
              {gs.status !== "lobby" ? (
                <div className="flex items-center gap-1.5">
                  <div className="flex">
                    {Array.from({ length: fan }, (_, i) => (
                      <Card key={i} faceDown size="xs" className={i ? "-ml-5" : ""} style={{ rotate: (i - (fan - 1) / 2) * 7 }} />
                    ))}
                  </div>
                  <span className="text-xs font-bold text-slate-300 tabular-nums">{count}</span>
                  {count === 1 && gs.status === "playing" && (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="rounded-full bg-fogo-600 px-1.5 text-[10px] font-black text-white">!</motion.span>
                  )}
                  {turn && <Clock gs={gs} />}
                </div>
              ) : (
                <div className="text-[11px] text-slate-400">{p === gs.owner ? "criou a partida" : "pronto"}</div>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
