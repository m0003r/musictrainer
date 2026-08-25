import { CLEF_LABELS, type Clef } from "@music-trainer/core";

const GUIDES: Record<Clef, { symbol: string; text: string }> = {
  treble: { symbol: "𝄞", text: "2-я линейка, охваченная завитком, — соль первой октавы · g¹." },
  bass: { symbol: "𝄢", text: "4-я линейка между точками — фа малой октавы · f." },
  soprano: { symbol: "𝄡", text: "Центр ключа на 1-й линейке — до первой октавы · c¹." },
  mezzoSoprano: { symbol: "𝄡", text: "Центр ключа на 2-й линейке — до первой октавы · c¹." },
  alto: { symbol: "𝄡", text: "Центр ключа на 3-й линейке — до первой октавы · c¹." },
  tenor: { symbol: "𝄡", text: "Центр ключа на 4-й линейке — до первой октавы · c¹." },
  baritone: { symbol: "𝄢", text: "3-я линейка между точками — фа малой октавы · f." }
};

export function ClefGuide({ clefs }: { clefs: readonly Clef[] }) {
  if (clefs.length === 0) return null;

  return (
    <aside className="clef-guide" aria-label="Справочник опорных нот ключей">
      <div className="clef-guide-heading">
        <strong>Откуда считать</strong>
        <span>Соседняя линия или промежуток — следующая ступень.</span>
      </div>
      <div className="clef-guide-cards">
        {clefs.map((clef) => <div key={clef}>
          <span className="clef-symbol" aria-hidden="true">{GUIDES[clef].symbol}</span>
          <p><strong>{CLEF_LABELS[clef]}</strong><br />{GUIDES[clef].text}</p>
        </div>)}
      </div>
    </aside>
  );
}
