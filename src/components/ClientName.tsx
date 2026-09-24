"use client";

import { createContext, useContext } from "react";

const ClientNameContext = createContext("the client");

/**
 * The client's first name, for editor-facing copy. "Adam is reviewing" reads
 * like a person; "the client is reviewing" reads like a ticket system. Set once
 * in the app layout from the owner's profile.
 */
export function ClientNameProvider({ name, children }: { name: string; children: React.ReactNode }) {
  return <ClientNameContext.Provider value={name}>{children}</ClientNameContext.Provider>;
}

export function useClientName(): string {
  return useContext(ClientNameContext);
}
