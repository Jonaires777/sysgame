export function Logo({ big = false }: { big?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`relative ${big ? "h-12 w-12" : "h-8 w-8"}`}>
        <div className="absolute inset-y-0 left-0 w-[62%] -rotate-12 rounded-md bg-gradient-to-br from-agua-400 to-agua-600 shadow" />
        <div className="absolute inset-y-0 right-0 w-[62%] rotate-12 rounded-md bg-gradient-to-br from-fogo-400 to-fogo-600 shadow" />
        <div className="absolute left-1/2 top-1/2 h-[38%] w-[38%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold-400 ring-2 ring-ink-950" />
      </div>
      <span className={`font-display font-black tracking-tight ${big ? "text-4xl" : "text-lg"}`}>
        Última <span className="text-gold-400 text-glow">Carta</span>
      </span>
    </div>
  );
}
