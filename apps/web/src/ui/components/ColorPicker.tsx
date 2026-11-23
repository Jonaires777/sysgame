import { AnimatePresence, motion } from "motion/react";
import { COLORS, COLOR_NAMES } from "../../domain/cards";
import type { ColorCode } from "../../domain/protocol";
import { SUIT_BG, SUIT_ICON } from "./Card";

/** Escolha da cor ao jogar um coringa. */
export function ColorPicker({ open, onPick, onCancel }: { open: boolean; onPick: (c: ColorCode) => void; onCancel: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onCancel}
        >
          <motion.div
            className="glass w-full max-w-sm p-5"
            initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-center text-lg font-extrabold">Escolha o elemento</h3>
            <div className="grid grid-cols-2 gap-3">
              {COLORS.map((c, i) => {
                const Icon = SUIT_ICON[c];
                return (
                  <motion.button
                    key={c}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: i * 0.05 } }}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => onPick(c)}
                    className={`flex h-24 flex-col items-center justify-center gap-1 rounded-2xl font-bold text-white shadow-lg ring-1 ring-white/25 ${SUIT_BG[c]}`}
                  >
                    <Icon size={30} />
                    {COLOR_NAMES[c]}
                  </motion.button>
                );
              })}
            </div>
            <button onClick={onCancel} className="mt-4 w-full rounded-xl py-2 text-sm text-slate-400 hover:text-white">Cancelar</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
