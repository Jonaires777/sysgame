import { useEffect, useRef, useState } from "react";
import { Bot, Send } from "lucide-react";
import { short } from "../../domain/protocol";
import type { ChatMessage } from "../../store/store";
import { Avatar } from "./Avatar";

/** Histórico da mesa (avisos do bot) e chat da sala. */
export function Chat({ messages, bot, onSend, className = "" }: {
  messages: ChatMessage[];
  bot: string;
  onSend: (text: string) => void;
  className?: string;
}) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <ol
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
        }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 text-sm"
      >
        {messages.slice(-80).map((m) => {
          const fromBot = m.sender === bot;
          return (
            <li key={m.id} className="flex gap-2">
              {fromBot ? (
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-600 text-gold-300"><Bot size={15} /></div>
              ) : (
                <Avatar user={m.sender} size={28} />
              )}
              <div className={`min-w-0 rounded-2xl px-3 py-1.5 ${fromBot ? "bg-white/5 text-slate-300" : "bg-agua-600/25 text-slate-100"}`}>
                {!fromBot && <div className="text-[11px] font-bold text-agua-400">{short(m.sender)}</div>}
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
              </div>
            </li>
          );
        })}
      </ol>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onSend(text);
          setText("");
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Mensagem (ou !comando)"
          className="h-11 min-w-0 flex-1 rounded-2xl bg-black/30 px-4 text-sm outline-none ring-1 ring-white/10 placeholder:text-slate-500 focus:ring-gold-400/60"
        />
        <button className="grid h-11 w-11 place-items-center rounded-2xl bg-gold-400 text-ink-950 transition hover:brightness-105" title="Enviar">
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
