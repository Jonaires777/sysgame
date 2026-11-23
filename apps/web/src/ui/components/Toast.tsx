import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Info } from "lucide-react";
import { useStore } from "../../store/store";

export function ToastHost() {
  const { toast } = useStore();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4" aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12 }}
            className={`flex max-w-md items-start gap-2 rounded-2xl px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur-xl ${
              toast.kind === "error" ? "bg-fogo-600/90 text-white ring-1 ring-fogo-400/50" : "bg-agua-600/90 text-white ring-1 ring-agua-400/50"
            }`}
          >
            {toast.kind === "error" ? <AlertTriangle size={18} className="mt-0.5 shrink-0" /> : <Info size={18} className="mt-0.5 shrink-0" />}
            <span>{toast.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
