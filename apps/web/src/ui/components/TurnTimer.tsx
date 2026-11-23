import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { short, type GameState } from "../../domain/protocol";

/** Segundos restantes da vez atual. O prazo vem do bot (turn_deadline, ms); depende do relógio do aparelho. */
export function useTurnSeconds(gs: GameState | null): { left: number; total: number } | null {
  const [now, setNow] = useState(() => Date.now());
  const active = !!gs && gs.status === "playing" && !!gs.turn_deadline && !!gs.turn_timeout;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);
  if (!active) return null;
  const total = gs!.turn_timeout!;
  const left = Math.max(0, Math.min(total, (gs!.turn_deadline! - now) / 1000));
  return { left, total };
}

export const timerTone = (left: number, total: number) =>
  left <= 10 ? "danger" : left <= total / 3 ? "warn" : "ok";

const BAR = { ok: "from-terra-400 to-terra-600", warn: "from-vento-400 to-vento-600", danger: "from-fogo-400 to-fogo-600" };

export function TurnTimer({ gs, me }: { gs: GameState | null; me: string | null }) {
  const t = useTurnSeconds(gs);
  if (!t || !gs) return null;
  const tone = timerTone(t.left, t.total);
  const who = gs.current === me ? "Seu tempo" : `Tempo de ${short(gs.current)}`;
  return (
    <div className="relative mx-auto h-7 w-full max-w-md overflow-hidden rounded-full bg-black/35 ring-1 ring-white/10">
      <div
        className={`absolute inset-y-0 left-0 bg-gradient-to-r transition-[width] duration-300 ease-linear ${BAR[tone]}`}
        style={{ width: `${(t.left / t.total) * 100}%` }}
      />
      <div className="relative flex h-full items-center justify-center gap-1.5 text-xs font-bold tabular-nums text-white drop-shadow">
        <Timer size={14} />
        {t.left > 0 ? `${who}: ${Math.ceil(t.left)}s` : `${who}: esgotado`}
      </div>
    </div>
  );
}
