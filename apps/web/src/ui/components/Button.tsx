import { motion, type HTMLMotionProps } from "motion/react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT: Record<Variant, string> = {
  primary: "bg-gradient-to-b from-gold-300 to-gold-500 text-ink-950 shadow-lg shadow-gold-500/25 hover:brightness-105",
  secondary: "bg-white/8 text-slate-100 ring-1 ring-white/15 hover:bg-white/12",
  ghost: "text-slate-300 hover:bg-white/8 hover:text-white",
  danger: "bg-fogo-600/90 text-white ring-1 ring-fogo-400/60 hover:bg-fogo-600",
};

interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
}

export function Button({ variant = "secondary", size = "md", className = "", disabled, ...rest }: ButtonProps) {
  const sz = size === "sm" ? "h-9 px-3 text-sm" : size === "lg" ? "h-13 px-6 text-base" : "h-11 px-4 text-sm";
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.96 }}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition disabled:opacity-40 disabled:saturate-50 ${sz} ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  );
}
