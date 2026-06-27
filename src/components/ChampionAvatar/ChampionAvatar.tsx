import { useState } from "react";
import { championIconUrl, useDdragonVersion } from "../../lib/ddragon";
import "./ChampionAvatar.css";

// Real square icon from Data Dragon, falling back to an initial-on-circle
// if the image 404s (e.g. an unreleased/renamed champion id we don't have
// mapped right) so a bad championName never shows a broken-image icon.
export function ChampionAvatar({ championName, size = 36 }: { championName: string; size?: number }) {
  const version = useDdragonVersion();
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="champion-avatar" style={{ width: size, height: size, fontSize: size * 0.42 }} title={championName}>
        {championName.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      className="champion-avatar champion-avatar-img"
      style={{ width: size, height: size }}
      src={championIconUrl(championName, version)}
      alt={championName}
      title={championName}
      onError={() => setFailed(true)}
    />
  );
}
