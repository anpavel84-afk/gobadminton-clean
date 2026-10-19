"use client";
import { useEffect, useState } from "react";
import { mapDebugEnabled, mapLogEntries, subscribeMapLog } from "../../../lib/games-map-debug";
export function GamesMapDebugPanel() {
  const [enabled, setEnabled] = useState(false);
  const [closed, setClosed] = useState(false);
  const [, update] = useState(0);
  useEffect(() => { setEnabled(mapDebugEnabled()); return subscribeMapLog(() => update(n => n + 1)); }, []);
  if (!enabled || closed) return null;
  const copy = async () => {
    const json = JSON.stringify(mapLogEntries(), null, 2);
    try { await navigator.clipboard.writeText(json); }
    catch {
      const text = document.createElement("textarea"); text.value = json;
      document.body.append(text); text.select();
      try { document.execCommand("copy"); } finally { text.remove(); }
    }
  };
  return <aside aria-label="Диагностика карты" style={{ position: "fixed", bottom: "calc(env(safe-area-inset-bottom) + 12px)", left: 8, right: 8, zIndex: 10000, maxHeight: "40vh", overflow: "auto", fontFamily: "monospace", background: "#fff", color: "#111", padding: 8 }}>
    <button type="button" onClick={copy}>Скопировать</button> <button type="button" onClick={() => setClosed(true)}>Закрыть</button>
    <pre style={{ whiteSpace: "pre-wrap" }}>{mapLogEntries().slice(-60).map(entry => JSON.stringify(entry)).join("\n")}</pre>
  </aside>;
}
