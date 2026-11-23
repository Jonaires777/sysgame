import { AnimatePresence, motion } from "motion/react";
import { useStore } from "./store/store";
import { TopBar } from "./ui/components/TopBar";
import { ToastHost } from "./ui/components/Toast";
import { LoginPage } from "./ui/pages/LoginPage";
import { LobbyPage } from "./ui/pages/LobbyPage";
import { GamePage } from "./ui/pages/GamePage";

export default function App() {
  const s = useStore();
  const page = s.view === "login" ? <LoginPage /> : s.view === "lobby" ? <LobbyPage /> : <GamePage />;
  return (
    <div className="flex min-h-full flex-col">
      <TopBar />
      <AnimatePresence mode="wait">
        <motion.main
          key={s.view}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22 }}
          className="mx-auto w-full max-w-6xl flex-1 px-4 pb-8 pt-4 sm:px-6"
        >
          {page}
        </motion.main>
      </AnimatePresence>
      <ToastHost />
    </div>
  );
}
