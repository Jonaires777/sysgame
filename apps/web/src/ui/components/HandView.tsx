import { AnimatePresence, motion } from "motion/react";
import { sortHand } from "../../domain/cards";
import { Card } from "./Card";

/**
 * Mão do jogador em leque. As cartas se sobrepõem mais quanto mais cartas houver,
 * e a carta jogável sobe ao passar o mouse/tocar.
 */
export function HandView({ cards, playable, myTurn, onPlay }: {
  cards: string[];
  playable: Set<string>;
  myTurn: boolean;
  onPlay: (card: string) => void;
}) {
  const sorted = sortHand(cards);
  const n = sorted.length;
  const overlap = n > 12 ? 44 : n > 9 ? 38 : n > 6 ? 28 : n > 4 ? 16 : 6;
  const spread = Math.min(5, 36 / Math.max(n, 1));
  // chave estável para cartas repetidas (ex.: dois "F7")
  const seen: Record<string, number> = {};
  const keyed = sorted.map((c) => ({ c, key: `${c}#${(seen[c] = (seen[c] ?? 0) + 1)}` }));

  return (
    <div className="no-scrollbar -mx-4 overflow-x-auto px-4 pb-2 pt-6">
      <div className="mx-auto flex w-max items-end justify-center px-2">
        <AnimatePresence initial={false}>
          {keyed.map(({ c, key }, i) => {
            const ok = playable.has(c);
            const mid = (n - 1) / 2;
            return (
              <motion.div
                key={key}
                layout
                initial={{ y: -80, opacity: 0, scale: 0.7 }}
                animate={{ y: Math.abs(i - mid) ** 1.6 * 0.9, opacity: 1, scale: 1, rotate: (i - mid) * spread }}
                exit={{ y: -120, opacity: 0, scale: 0.8, transition: { duration: 0.25 } }}
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
                style={{ marginLeft: i ? -overlap : 0, zIndex: i }}
                className="origin-bottom"
              >
                <Card
                  code={c}
                  size="md"
                  playable={ok}
                  dimmed={myTurn && !ok}
                  whileHover={ok ? { y: -18, scale: 1.06 } : undefined}
                  whileTap={ok ? { scale: 0.95 } : undefined}
                  onClick={ok ? () => onPlay(c) : undefined}
                  className={ok ? "cursor-pointer" : ""}
                  role={ok ? "button" : undefined}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
