import { useState } from "react";
import { motion } from "motion/react";
import { LogIn, Server, UserPlus } from "lucide-react";
import { authenticate, useStore } from "../../store/store";
import { MatrixError } from "../../infra/matrix/client";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Logo } from "../components/Logo";

const HERO = ["F7", "A+2", "C", "TB", "VI"];

export function LoginPage() {
  const s = useStore();
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [hs, setHs] = useState(s.homeserver);
  const [busy, setBusy] = useState<"login" | "register" | null>(null);
  const [error, setError] = useState("");

  async function submit(mode: "login" | "register") {
    setError("");
    if (!/^[a-z0-9._=-]+$/.test(user.trim().toLowerCase())) return setError("Nome: letras minúsculas, números, . _ = -");
    if (pass.length < 4) return setError("A senha precisa de pelo menos 4 caracteres");
    setBusy(mode);
    try {
      await authenticate(mode, user.trim().toLowerCase(), pass, hs);
    } catch (e) {
      const code = e instanceof MatrixError ? e.errcode : undefined;
      const msg = code === "M_USER_IN_USE" ? "Esse nome já existe; use Entrar"
        : code === "M_FORBIDDEN" ? "Usuário ou senha incorretos"
        : (e as Error).message || "Não consegui falar com o homeserver";
      setError(msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid items-center gap-10 py-6 lg:grid-cols-2 lg:py-16 [&>*]:min-w-0">
      <div className="text-center lg:text-left">
        <div className="mb-8 flex h-44 items-end justify-center lg:justify-start">
          {HERO.map((c, i) => (
            <motion.div
              key={c}
              initial={{ y: 80, opacity: 0, rotate: 0 }}
              animate={{ y: Math.abs(i - 2) * 10, opacity: 1, rotate: (i - 2) * 11 }}
              transition={{ delay: 0.1 + i * 0.08, type: "spring", stiffness: 180, damping: 16 }}
              className="origin-bottom"
              style={{ marginLeft: i ? -28 : 0 }}
            >
              <Card code={c} size="md" whileHover={{ y: -14 }} />
            </motion.div>
          ))}
        </div>
        <div className="flex justify-center lg:justify-start"><Logo big /></div>
        <p className="mx-auto mt-4 max-w-md text-balance text-slate-400 lg:mx-0">
          Jogo de cartas multiplayer por turnos sobre o protocolo <b className="text-slate-200">Matrix</b>.
          Combine elemento ou valor, use os coringas e seja o primeiro a esvaziar a mão.
        </p>
      </div>

      <motion.form
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass mx-auto w-full max-w-md space-y-4 p-6 sm:p-8"
        onSubmit={(e) => { e.preventDefault(); void submit("login"); }}
      >
        <div>
          <h2 className="text-2xl font-extrabold">Entrar no jogo</h2>
          <p className="mt-1 text-sm text-slate-400">Sua conta é uma conta Matrix deste servidor. Primeira vez? Escolha um nome e uma senha e toque em <b>Criar conta</b>.</p>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">Nome de usuário</span>
          <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" autoCapitalize="none"
            className="h-12 w-full rounded-2xl bg-black/30 px-4 outline-none ring-1 ring-white/10 focus:ring-gold-400/60" placeholder="ex.: ana" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">Senha</span>
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password"
            className="h-12 w-full rounded-2xl bg-black/30 px-4 outline-none ring-1 ring-white/10 focus:ring-gold-400/60" />
        </label>
        <details className="group text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-slate-400 hover:text-slate-200">
            <Server size={14} /> Servidor
          </summary>
          <input value={hs} onChange={(e) => setHs(e.target.value)}
            className="mt-2 h-10 w-full rounded-xl bg-black/30 px-3 text-sm outline-none ring-1 ring-white/10 focus:ring-gold-400/60" />
        </details>
        {error && <p className="rounded-xl bg-fogo-600/20 px-3 py-2 text-sm text-fogo-400 ring-1 ring-fogo-600/40">{error}</p>}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <Button type="submit" variant="primary" size="lg" disabled={!!busy}>
            <LogIn size={18} /> {busy === "login" ? "Entrando…" : "Entrar"}
          </Button>
          <Button type="button" size="lg" disabled={!!busy} onClick={() => void submit("register")}>
            <UserPlus size={18} /> {busy === "register" ? "Criando…" : "Criar conta"}
          </Button>
        </div>
      </motion.form>
    </div>
  );
}
