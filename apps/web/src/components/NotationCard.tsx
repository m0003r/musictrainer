import { useEffect, useRef, useState } from "react";
import { noteToMusicXml, type Clef, type KeyFifths, type Note, type WrittenAccidental } from "@music-trainer/core";

interface NotationCardProps {
  note: Note | readonly Note[];
  clef: Clef;
  keyFifths?: KeyFifths;
  writtenAccidental?: WrittenAccidental | null | readonly (WrittenAccidental | null)[];
  onRendered?: () => void;
}

export const NOTATION_RENDER_OPTIONS = {
  autoResize: true,
  backend: "svg",
  drawTitle: false,
  drawPartNames: false,
  drawMeasureNumbers: false,
  drawTimeSignatures: false
} as const;

export function NotationCard({ note, clef, keyFifths = 0, writtenAccidental = null, onRendered }: NotationCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    container.replaceChildren();
    setError(false);

    void import("opensheetmusicdisplay").then(async ({ OpenSheetMusicDisplay }) => {
      if (cancelled) return;
      const osmd = new OpenSheetMusicDisplay(container, NOTATION_RENDER_OPTIONS);
      await osmd.load(noteToMusicXml(note, clef, keyFifths, writtenAccidental));
      if (!cancelled) {
        osmd.render();
        onRendered?.();
      }
    }).catch(() => {
      if (!cancelled) setError(true);
    });

    return () => {
      cancelled = true;
      container.replaceChildren();
    };
  }, [clef, keyFifths, JSON.stringify(note), onRendered, retryKey, JSON.stringify(writtenAccidental)]);

  return (
    <div className="notation-shell">
      <div className="notation-card" ref={containerRef} aria-label="Нотная запись" />
      {error && (
        <div className="notation-error" role="alert">
          <span>Не удалось показать ноту</span>
          <button type="button" onClick={() => setRetryKey((current) => current + 1)}>Повторить</button>
        </div>
      )}
    </div>
  );
}
