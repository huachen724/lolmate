// Static game assets (champion squares, profile icons) come straight from
// Riot's Data Dragon CDN — no API key needed, safe to hit from the browser
// directly. Ranked emblem crests aren't hot-linkable from Data Dragon
// itself (only shipped as a downloadable zip), so those come from
// CommunityDragon's "latest" mirror instead, which is what most
// third-party LoL sites use for this.
import { useEffect, useState } from "react";

// Used until the real latest version loads (almost instant) and as a
// fallback if the version fetch ever fails. Data Dragon keeps old version
// folders around indefinitely, so a slightly stale version still works for
// every champion that existed as of that patch.
const FALLBACK_VERSION = "14.23.1";

let cachedVersion: string | null = null;
let versionPromise: Promise<string> | null = null;

function loadLatestVersion(): Promise<string> {
  if (!versionPromise) {
    versionPromise = fetch("https://ddragon.leagueoflegends.com/api/versions.json")
      .then((res) => res.json())
      .then((versions: string[]) => {
        cachedVersion = versions[0];
        return cachedVersion;
      })
      .catch(() => FALLBACK_VERSION);
  }
  return versionPromise;
}

// Kick the fetch off as soon as this module loads, instead of waiting for
// the first component that needs it.
void loadLatestVersion();

export function useDdragonVersion(): string {
  const [version, setVersion] = useState(cachedVersion ?? FALLBACK_VERSION);

  useEffect(() => {
    if (cachedVersion) return;
    loadLatestVersion().then(setVersion);
  }, []);

  return version;
}

// `championName` must be Data Dragon's id form (e.g. "MonkeyKing",
// "DrMundo") — match-v5's championName field, and server.js's live-game
// route, both already return it in this form.
export function championIconUrl(championName: string, version: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championName}.png`;
}

export function profileIconUrl(profileIconId: number, version: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${profileIconId}.png`;
}

export function rankEmblemUrl(tier: string): string {
  return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/ranked-emblem/emblem-${tier.toLowerCase()}.png`;
}
