import { short } from "../../domain/protocol";

const GRADIENTS = [
  "from-fogo-400 to-fogo-600",
  "from-agua-400 to-agua-600",
  "from-terra-400 to-terra-600",
  "from-vento-400 to-vento-600",
  "from-fuchsia-400 to-violet-600",
  "from-cyan-300 to-teal-600",
];

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function Avatar({ user, size = 40, className = "" }: { user: string; size?: number; className?: string }) {
  const name = short(user);
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-bold text-white shadow-md ring-2 ring-white/10 ${GRADIENTS[hash(name) % GRADIENTS.length]} ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      title={name}
    >
      {initials}
    </div>
  );
}
