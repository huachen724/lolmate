import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getRecentSearches } from "../../lib/session";
import type { RiotId } from "../../types";
import "./SearchBar.css";

interface SearchBarProps {
  variant?: "hero" | "compact";
  placeholder?: string;
}

// The single entry point for "find a player". Resolving gameName#tagLine ->
// puuid is account-v1 (server.js's getAccountByRiotId); see
// PlayerProfilePage for where that lookup actually happens once a search
// is submitted.
export function SearchBar({ variant = "compact", placeholder }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [showRecent, setShowRecent] = useState(false);
  const [recent, setRecent] = useState<RiotId[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowRecent(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function goToRiotId(riotId: RiotId) {
    setQuery("");
    setShowRecent(false);
    navigate(`/profile/${encodeURIComponent(riotId.gameName)}/${encodeURIComponent(riotId.tagLine)}`);
  }

  function handleFocus() {
    setRecent(getRecentSearches());
    setShowRecent(true);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    const [gameName, tagLine] = trimmed.includes("#")
      ? trimmed.split("#")
      : [trimmed, "NA1"];

    if (!gameName) return;
    goToRiotId({ gameName, tagLine: tagLine || "NA1" });
  }

  return (
    <div className={`search-bar search-bar-${variant}`} ref={containerRef}>
      <form onSubmit={handleSubmit} className="search-bar-form">
        <svg className="search-bar-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 5L20.49 19zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"
          />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={handleFocus}
          placeholder={placeholder ?? "Search Riot ID, e.g. Faye#NA1"}
          aria-label="Search for a player by Riot ID"
        />
        {variant === "hero" && (
          <button type="submit" className="btn btn-primary search-bar-submit">
            Search
          </button>
        )}
      </form>

      {showRecent && recent.length > 0 && (
        <div className="search-bar-recent card">
          <div className="search-bar-recent-label faint">Recently searched</div>
          {recent.map((riotId) => (
            <button
              key={`${riotId.gameName}#${riotId.tagLine}`}
              type="button"
              className="search-bar-recent-item"
              onClick={() => goToRiotId(riotId)}
            >
              <span>{riotId.gameName}</span>
              <span className="faint">#{riotId.tagLine}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
