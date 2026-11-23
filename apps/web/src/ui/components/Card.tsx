import { motion, type HTMLMotionProps } from "motion/react";
import { Ban, Droplet, Flame, Leaf, Repeat, Sparkles, Wind, type LucideIcon } from "lucide-react";
import { cardInfo, COLOR_NAMES } from "../../domain/cards";
import type { ColorCode } from "../../domain/protocol";

export const SUIT_ICON: Record<ColorCode, LucideIcon> = { F: Flame, A: Droplet, T: Leaf, V: Wind };

export const SUIT_BG: Record<ColorCode, string> = {
  F: "bg-gradient-to-br from-fogo-400 to-fogo-600",
  A: "bg-gradient-to-br from-agua-400 to-agua-600",
  T: "bg-gradient-to-br from-terra-400 to-terra-600",
  V: "bg-gradient-to-br from-vento-400 to-vento-600",
};

export const SUIT_SOLID: Record<ColorCode, string> = {
  F: "bg-fogo-600", A: "bg-agua-600", T: "bg-terra-600", V: "bg-vento-600",
};

const GLOW: Record<ColorCode, string> = {
  F: "0 0 0 3px #ff7a4d, 0 0 28px 4px rgb(255 122 77 / 0.55)",
  A: "0 0 0 3px #4cc3ff, 0 0 28px 4px rgb(76 195 255 / 0.55)",
  T: "0 0 0 3px #5fe08a, 0 0 28px 4px rgb(95 224 138 / 0.55)",
  V: "0 0 0 3px #ffd95a, 0 0 28px 4px rgb(255 217 90 / 0.55)",
};

export type CardSize = "xs" | "sm" | "md" | "lg";

const SIZE: Record<CardSize, { box: string; center: string; corner: string; icon: number; cornerIcon: number; mark: number }> = {
  xs: { box: "w-7 h-10 rounded-md", center: "text-sm", corner: "hidden", icon: 12, cornerIcon: 0, mark: 0 },
  sm: { box: "w-12 h-[4.5rem] rounded-lg", center: "text-xl", corner: "text-[9px]", icon: 18, cornerIcon: 8, mark: 34 },
  md: { box: "w-[4.6rem] h-[6.9rem] rounded-xl", center: "text-3xl", corner: "text-[11px]", icon: 30, cornerIcon: 10, mark: 56 },
  lg: { box: "w-24 h-36 sm:w-28 sm:h-[10.5rem] rounded-2xl", center: "text-5xl", corner: "text-xs", icon: 42, cornerIcon: 12, mark: 80 },
};

interface CardProps extends Omit<HTMLMotionProps<"div">, "children"> {
  code?: string;
  faceDown?: boolean;
  size?: CardSize;
  chosenColor?: ColorCode | null;
  playable?: boolean;
  dimmed?: boolean;
}

export function Card({ code, faceDown, size = "md", chosenColor, playable, dimmed, className = "", ...rest }: CardProps) {
  const sz = SIZE[size];
  const base = `relative shrink-0 select-none overflow-hidden ${sz.box} ${className}`;
  const style = {
    boxShadow: playable
      ? "0 0 0 2px rgb(252 201 75), 0 10px 25px -5px rgb(0 0 0 / 0.6), 0 0 22px rgb(252 201 75 / 0.35)"
      : chosenColor ? GLOW[chosenColor] : "0 8px 20px -6px rgb(0 0 0 / 0.65)",
    filter: dimmed ? "saturate(0.45) brightness(0.62)" : undefined,
  };

  if (faceDown || !code) {
    return (
      <motion.div {...rest} className={`${base} border border-white/15 bg-ink-800`} style={style} aria-label="Carta virada">
        <div className="absolute inset-1 rounded-[inherit] border border-gold-400/30 bg-[repeating-linear-gradient(135deg,#1c2538_0_6px,#131a28_6px_12px)]" />
        <div className="absolute inset-0 grid place-items-center">
          <div className={`rounded-full bg-gradient-to-br from-gold-300 to-gold-500 px-1.5 py-0.5 text-center font-black uppercase leading-none tracking-tight text-ink-900 shadow ${size === "lg" ? "text-sm" : size === "md" ? "text-[10px]" : "text-[7px]"} ${size === "xs" ? "hidden" : ""}`}>
            Última<br />Carta
          </div>
        </div>
      </motion.div>
    );
  }

  const info = cardInfo(code);

  if (!info.color) {
    // Coringa: fundo escuro com anel dos quatro elementos
    return (
      <motion.div {...rest} className={`${base} border border-white/20 bg-gradient-to-br from-ink-700 to-ink-950`} style={style} title={info.name} aria-label={info.name}>
        <div className="absolute inset-[14%] rounded-full opacity-90"
          style={{ background: "conic-gradient(#d9283f 0 25%, #2257e0 0 50%, #138a52 0 75%, #e08a0b 0)" }} />
        <div className="absolute inset-[22%] grid place-items-center rounded-full bg-ink-900 ring-1 ring-white/20">
          {info.kind === "wild4"
            ? <span className={`font-black text-white ${sz.center}`}>+4</span>
            : <Sparkles size={sz.icon} className="text-gold-300" />}
        </div>
        {size !== "xs" && (
          <>
            <Sparkles size={sz.cornerIcon} className="absolute left-1.5 top-1.5 text-gold-300" />
            <Sparkles size={sz.cornerIcon} className="absolute bottom-1.5 right-1.5 rotate-180 text-gold-300" />
          </>
        )}
        {chosenColor && size !== "xs" && (
          <div className={`absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full px-1.5 text-[9px] font-bold text-white ${SUIT_SOLID[chosenColor]}`}>
            {COLOR_NAMES[chosenColor]}
          </div>
        )}
      </motion.div>
    );
  }

  const Suit = SUIT_ICON[info.color];
  const center =
    info.kind === "skip" ? <Ban size={sz.icon} strokeWidth={2.6} /> :
    info.kind === "reverse" ? <Repeat size={sz.icon} strokeWidth={2.6} /> :
    <span className={`font-black tracking-tight ${sz.center}`}>{info.label}</span>;
  const corner = info.kind === "skip" ? "⦸" : info.kind === "reverse" ? "⇄" : info.label;

  return (
    <motion.div {...rest} className={`${base} border border-white/25 ${SUIT_BG[info.color]}`} style={style} title={info.name} aria-label={info.name}>
      {/* brilho e textura */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgb(255_255_255/0.35),transparent_55%)]" />
      <div className="absolute inset-[6%] rounded-[inherit] border border-white/30" />
      {sz.mark > 0 && <Suit size={sz.mark} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/15" strokeWidth={1.5} />}
      <div className="absolute inset-0 grid place-items-center text-white drop-shadow-[0_2px_2px_rgb(0_0_0/0.35)]">{center}</div>
      {size !== "xs" && (
        <>
          <div className={`absolute left-1.5 top-1 flex flex-col items-center font-extrabold leading-none text-white ${sz.corner}`}>
            <span>{corner}</span>
            <Suit size={sz.cornerIcon} strokeWidth={2.5} />
          </div>
          <div className={`absolute bottom-1 right-1.5 flex rotate-180 flex-col items-center font-extrabold leading-none text-white ${sz.corner}`}>
            <span>{corner}</span>
            <Suit size={sz.cornerIcon} strokeWidth={2.5} />
          </div>
        </>
      )}
    </motion.div>
  );
}
