import { motion } from "motion/react";
import { useMemo } from "react";

const COLORS = ["#ff7a4d", "#4cc3ff", "#5fe08a", "#ffd95a", "#fcc94b", "#ffffff"];

/** Chuva de confetes simples (só motion, sem biblioteca extra). */
export function Celebration() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 48 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        duration: 2.2 + Math.random() * 1.6,
        rotate: (Math.random() - 0.5) * 720,
        color: COLORS[i % COLORS.length],
        w: 6 + Math.random() * 6,
      })),
    [],
  );
  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {pieces.map((p) => (
        <motion.div
          key={p.id}
          className="absolute top-0 rounded-sm"
          style={{ left: `${p.left}%`, width: p.w, height: p.w * 1.6, background: p.color }}
          initial={{ y: -40, rotate: 0, opacity: 1 }}
          animate={{ y: "105vh", rotate: p.rotate, opacity: [1, 1, 0.8] }}
          transition={{ delay: p.delay, duration: p.duration, ease: "easeIn", repeat: 1, repeatDelay: 0.4 }}
        />
      ))}
    </div>
  );
}
