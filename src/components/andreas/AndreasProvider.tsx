"use client";

import { createContext, useCallback, useContext, useState } from "react";

interface AutoAsk {
  text: string;
  nonce: number;
}

interface AndreasState {
  open: boolean;
  autoAsk: AutoAsk | null;
  /** Opens the panel. Pass a question to have it asked immediately, from
   *  anywhere in the tree — e.g. the Overview page's own "Ask Andreas" box —
   *  without that component needing to know the panel exists. */
  openWith: (question?: string) => void;
  close: () => void;
}

const AndreasContext = createContext<AndreasState | null>(null);

export function AndreasProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [autoAsk, setAutoAsk] = useState<AutoAsk | null>(null);

  const openWith = useCallback((question?: string) => {
    if (question?.trim()) setAutoAsk({ text: question.trim(), nonce: Date.now() });
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  return (
    <AndreasContext.Provider value={{ open, autoAsk, openWith, close }}>{children}</AndreasContext.Provider>
  );
}

export function useAndreas() {
  const ctx = useContext(AndreasContext);
  if (!ctx) throw new Error("useAndreas must be used within AndreasProvider");
  return ctx;
}
