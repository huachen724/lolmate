// Light is the CSS default (see index.css's bare :root); dark applies via
// either OS preference (a media query) or this explicit override
// (documentElement[data-theme]), which always wins over OS preference.
// No stored preference means "follow the OS" — nothing gets written to
// localStorage until the user actually toggles.
export type Theme = "light" | "dark";

const STORAGE_KEY = "lolmate.theme.v1";

export function getStoredTheme(): Theme | null {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
}

export function getSystemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getEffectiveTheme(): Theme {
  return getStoredTheme() ?? getSystemTheme();
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function setStoredTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}
