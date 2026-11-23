import { LogOut } from "lucide-react";
import { logout, me, useStore } from "../../store/store";
import { short } from "../../domain/protocol";
import { Avatar } from "./Avatar";
import { Logo } from "./Logo";

export function TopBar() {
  const s = useStore();
  const user = me(s);
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-ink-950/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        {user && (
          <div className="flex items-center gap-2">
            <Avatar user={user} size={30} />
            <span className="hidden text-sm font-medium text-slate-300 sm:inline">{short(user)}</span>
            <button onClick={() => logout()} className="rounded-xl p-2 text-slate-400 transition hover:bg-white/8 hover:text-white" title="Sair da conta">
              <LogOut size={18} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
