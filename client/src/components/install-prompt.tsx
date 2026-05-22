import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DealinsecLogo } from "@/components/dealinsec-logo";

const DISMISS_KEY = "pwa-install-dismissed-at";
const DISMISS_DAYS = 7; // re-show after a week if dismissed

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Custom "Install DealInSec" banner.
 * - Listens for the browser's beforeinstallprompt (Chrome/Edge/Android)
 * - Shows a branded banner; on accept, triggers the native install
 * - On iOS Safari (no beforeinstallprompt), shows manual "Add to Home Screen" hint
 * - Respects a 7-day dismiss cooldown
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Already installed (standalone) → never show
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    if (standalone) return;

    // Respect dismiss cooldown
    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    if (dismissedAt) {
      const days = (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60 * 24);
      if (days < DISMISS_DAYS) return;
    }

    // iOS Safari doesn't fire beforeinstallprompt
    const ios = /iphone|ipad|ipod/i.test(window.navigator.userAgent) &&
      !(window.navigator as any).standalone;
    if (ios) {
      setIsIOS(true);
      const t = setTimeout(() => setShow(true), 4000); // delay so it's not jarring
      return () => clearTimeout(t);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setTimeout(() => setShow(true), 4000);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShow(false);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setShow(false);
    } else {
      dismiss();
    }
    setDeferredPrompt(null);
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-x-0 bottom-0 z-[90] px-4 pb-[max(16px,env(safe-area-inset-bottom))] lg:bottom-4 lg:left-4 lg:right-auto lg:px-0 lg:max-w-sm"
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: "spring", damping: 24, stiffness: 280 }}
        >
          <div className="relative rounded-2xl border border-border/60 bg-card shadow-2xl shadow-black/10 p-4">
            <button
              onClick={dismiss}
              className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-start gap-3 pr-6">
              <div className="flex-shrink-0">
                <DealinsecLogo size="sm" withText={false} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-foreground">Install DealInSec</h3>
                {isIOS ? (
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    Tap <span className="font-semibold">Share</span> →{" "}
                    <span className="font-semibold">Add to Home Screen</span> for the full app experience.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    Add to your home screen for instant access, offline support, and a fullscreen app feel.
                  </p>
                )}

                {!isIOS && (
                  <div className="flex items-center gap-2 mt-3">
                    <Button
                      size="sm"
                      className="gradient-btn text-white h-8 px-3 text-xs font-semibold"
                      onClick={install}
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      Install
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-3 text-xs text-muted-foreground"
                      onClick={dismiss}
                    >
                      Not now
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
