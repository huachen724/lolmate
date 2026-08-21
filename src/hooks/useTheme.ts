import { useEffect, useState } from "react";
import { applyTheme, getEffectiveTheme, getStoredTheme, setStoredTheme } from "../lib/theme";
import type { Theme } from "../lib/theme";

export function useTheme(): [Theme, () => void] {
  const [theme, setThemeState] = useState<Theme>(() => getEffectiveTheme());

  // index.html's inline script already applies the effective theme before
  // first paint (avoids a flash) — this just keeps React's own state in
  // sync with whatever it landed on.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    // Only follow OS changes live if the user hasn't made an explicit
    // choice — once they toggle, that choice sticks regardless of OS.
    if (getStoredTheme()) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setThemeState(getEffectiveTheme());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setStoredTheme(next);
    setThemeState(next);
  }

  return [theme, toggle];
}
