import { useEffect, useState } from "react";
import { fetchMe } from "../lib/api";
import { SESSION_CHANGED_EVENT } from "../lib/session";
import type { AuthUser } from "../types";

// undefined = still checking (GET /api/auth/me hasn't resolved yet), null =
// definitely signed out, AuthUser = signed in. Callers that need to avoid a
// flash-redirect (e.g. DashboardPage) should treat undefined as "wait,
// don't decide yet" rather than falsy-coercing it to "signed out".
export function useSession(): AuthUser | null | undefined {
  const [session, setSession] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    function load() {
      fetchMe()
        .then((res) => {
          if (!cancelled) setSession(res.user);
        })
        .catch(() => {
          if (!cancelled) setSession(null);
        });
    }

    load();
    window.addEventListener(SESSION_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(SESSION_CHANGED_EVENT, load);
    };
  }, []);

  return session;
}
