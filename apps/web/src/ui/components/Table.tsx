import { AnimatePresence, motion } from "motion/react";
import { RotateCcw, RotateCw } from "lucide-react";
import { COLOR_NAMES } from "../../domain/cards";
import type { GameState } from "../../domain/protocol";
import { Card, SUIT_ICON, SUIT_SOLID } from "./Card";

/** Mesa de feltro: monte de compra, pilha de descarte, cor atual e sentido. */
export function Table({ gs, canDraw, onDraw }: { gs: GameState; canDraw: boolean; onDraw: () => void }) {
  const playing = gs.status === "playing" || gs.status === "finished";
  const Suit = gs.color ? SUIT_ICON[gs.color] : null;
  // inclinação "aleatória" mas estável por jogada
  const tilt = ((gs.seq * 37) % 17) - 8;
  return (
    <div className="felt relative overflow-hidden rounded-[2rem] px-4 py-6 sm:py-8">
      <div className="felt-texture pointer-events-none absolute inset-0" />
      {playing && (
        <motion.div
          className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 text-white/10 sm:h-80 sm:w-80"
          animate={{ rotate: gs.direction === 1 ? 360 : -360 }}
          transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
        >
          {gs.direction === 1 ? <RotateCw className="h-full w-full" strokeWidth={0.6} /> : <RotateCcw className="h-full w-full" strokeWidth={0.6} />}
        </motion.div>
      )}

      <div className="relative flex items-center justify-center gap-8 sm:gap-14">
        {/* monte */}
        <div className="flex flex-col items-center gap-2">
          <motion.button
            type="button"
            onClick={canDraw ? onDraw : undefined}
            disabled={!canDraw}
            whileHover={canDraw ? { y: -4 } : undefined}
            whileTap={canDraw ? { scale: 0.95 } : undefined}
            className={`relative h-36 w-24 sm:h-[10.5rem] sm:w-28 ${canDraw ? "" : "opacity-70"}`}
            title={canDraw ? "Comprar uma carta" : "Monte"}
          >
            {/* bolo de cartas: duas por baixo, levemente deslocadas */}
            <div className="absolute left-1.5 top-1.5 opacity-50"><Card faceDown size="lg" /></div>
            <div className="absolute left-0.5 top-0.5 opacity-75"><Card faceDown size="lg" /></div>
            <div className={`absolute left-0 top-0 rounded-2xl ${canDraw ? "animate-pulse-ring" : ""}`}><Card faceDown size="lg" /></div>
          </motion.button>
          <span className="text-xs font-medium text-emerald-100/80">{playing ? `${gs.draw_pile} no monte` : "monte"}</span>
        </div>

        {/* descarte */}
        <div className="flex flex-col items-center gap-2">
          <div className="relative h-36 w-24 sm:h-[10.5rem] sm:w-28">
            <AnimatePresence initial={false}>
              {gs.top_card ? (
                <motion.div
                  key={`${gs.top_card}-${gs.seq}`}
                  className="absolute inset-0"
                  initial={{ y: 60, scale: 0.6, rotate: tilt - 25, opacity: 0 }}
                  animate={{ y: 0, scale: 1, rotate: tilt, opacity: 1 }}
                  exit={{ opacity: 0, transition: { delay: 0.25, duration: 0.1 } }}
                  transition={{ type: "spring", stiffness: 260, damping: 20 }}
                >
                  <Card code={gs.top_card} size="lg" chosenColor={gs.color} />
                </motion.div>
              ) : (
                <div className="grid h-full w-full place-items-center rounded-2xl border-2 border-dashed border-white/20 text-sm text-white/40">mesa</div>
              )}
            </AnimatePresence>
          </div>
          {gs.color && Suit ? (
            <motion.span
              key={gs.color}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold text-white shadow ${SUIT_SOLID[gs.color]}`}
            >
              <Suit size={13} /> {COLOR_NAMES[gs.color]}
            </motion.span>
          ) : (
            <span className="text-xs text-emerald-100/60">aguardando</span>
          )}
        </div>
      </div>
    </div>
  );
}
