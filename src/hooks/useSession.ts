import { useEffect, useState } from "react";
import { getSession, SESSION_CHANGED_EVENT } from "../lib/session";
import type { RiotSession } from "../lib/session";

export function useSession(): RiotSession | null {
  const [session, setSession] = useState<RiotSession | null>(() => getSession());

  useEffect(() => {
    const handler = () => setSession(getSession());
    window.addEventListener(SESSION_CHANGED_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(SESSION_CHANGED_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  return session;
}
