import type { Clef } from "@music-trainer/core";

export function ClefGuide({ clefs }: { clefs: readonly Clef[] }) {
  const showTreble = clefs.includes("treble");
  const showBass = clefs.includes("bass");
  if (!showTreble && !showBass) return null;

  return (
    <aside className="clef-guide" aria-label="Справочник опорных нот ключей">
      <div className="clef-guide-heading">
        <strong>Откуда считать</strong>
        <span>Соседняя линия или промежуток — следующая ступень.</span>
      </div>
      <div className="clef-guide-cards">
        {showTreble && (
          <div>
            <span className="clef-symbol" aria-hidden="true">𝄞</span>
            <p><strong>Скрипичный</strong><br />2-я линейка, охваченная завитком, — <b>соль первой октавы · g¹</b>.</p>
          </div>
        )}
        {showBass && (
          <div>
            <span className="clef-symbol" aria-hidden="true">𝄢</span>
            <p><strong>Басовый</strong><br />4-я линейка между точками — <b>фа малой октавы · f</b>.</p>
          </div>
        )}
      </div>
    </aside>
  );
}
