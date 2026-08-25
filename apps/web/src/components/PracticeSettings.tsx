import { useState, type ReactNode } from "react";
import {
  CLEFS,
  CLEF_LABELS,
  DIFFICULTY_PRESETS,
  REPRESENTATIONS,
  REPRESENTATION_LABELS,
  difficultyPreset,
  type Clef,
  type DiatonicDistance,
  type DifficultyLevel,
  type DifficultySettings,
  type KeySignatureCount,
  type LedgerLineCount,
  type MelodicDistance,
  type NotesPerQuestion,
  type OptionCount,
  type Representation
} from "@music-trainer/core";

export interface HintSettings {
  keyboardNoteLabels: boolean;
  keyboardOctaveLabels: boolean;
  clefGuide: boolean;
}

interface PracticeSettingsProps {
  level: DifficultyLevel;
  customDifficulty: boolean;
  difficulty: DifficultySettings;
  sources: readonly Representation[];
  targets: readonly Representation[];
  clefs: readonly Clef[];
  hints: HintSettings;
  autoAdvance: boolean;
  pendingNextQuestion: boolean;
  directionCount: number;
  midiControl: ReactNode;
  onLevelChange: (level: DifficultyLevel) => void;
  onDifficultyChange: (settings: DifficultySettings) => void;
  onToggleSource: (value: Representation) => void;
  onToggleTarget: (value: Representation) => void;
  onToggleClef: (value: Clef) => void;
  onHintChange: (name: keyof HintSettings, enabled: boolean) => void;
  onAutoAdvanceChange: (enabled: boolean) => void;
}

function CheckChip({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className="check-chip">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

export function PracticeSettings(props: PracticeSettingsProps) {
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches);
  const preset = difficultyPreset(props.level);

  return (
    <details className="setup-panel" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>Настройки</span>
        <small>{props.customDifficulty ? "Своя сложность" : `Уровень ${props.level}`} · связей: {props.directionCount} · ключей: {props.clefs.length}{props.pendingNextQuestion ? " · изменения со следующего примера" : ""}</small>
      </summary>
      <div className="setup-panel-body">
        {props.pendingNextQuestion && <p className="pending-settings" role="status">Новые параметры применятся со следующего примера.</p>}
        <section className="setting-section difficulty-section">
          <div className="setting-title-row">
            <h2>Сложность</h2>
            <span className="level-badge">{props.customDifficulty ? "Своя" : `Уровень ${props.level}`}</span>
          </div>
          <input
            className="level-range"
            type="range"
            min="1"
            max="6"
            step="1"
            value={props.level}
            aria-label="Уровень сложности"
            onChange={(event) => props.onLevelChange(Number(event.target.value) as DifficultyLevel)}
          />
          <div className="level-scale" aria-hidden="true">{DIFFICULTY_PRESETS.map((item) => <span key={item.level}>{item.level}</span>)}</div>
          <strong>{preset.label}</strong>
          <p>{props.customDifficulty ? "Параметры изменены вручную." : preset.description}</p>

          <div className="difficulty-controls">
            <label>
              Нот в примере: <output>{props.difficulty.notesPerQuestion}</output>
              <input type="range" min="1" max="5" step="1" value={props.difficulty.notesPerQuestion} onChange={(event) => props.onDifficultyChange({ ...props.difficulty, notesPerQuestion: Number(event.target.value) as NotesPerQuestion })} />
            </label>
            <label>
              Максимальный ход: <output>{props.difficulty.maxMelodicDistance} ступ.</output>
              <input type="range" min="1" max="8" step="1" value={props.difficulty.maxMelodicDistance} onChange={(event) => props.onDifficultyChange({ ...props.difficulty, maxMelodicDistance: Number(event.target.value) as MelodicDistance })} />
            </label>
            <label>
              Добавочные линейки: <output>{props.difficulty.ledgerLines === 0 ? "нет" : `±${props.difficulty.ledgerLines}`}</output>
              <input type="range" min="0" max="3" step="1" value={props.difficulty.ledgerLines} onChange={(event) => props.onDifficultyChange({ ...props.difficulty, ledgerLines: Number(event.target.value) as LedgerLineCount })} />
            </label>
            <label>
              Вариантов ответа: <output>{props.difficulty.optionCount}</output>
              <input type="range" min="2" max="6" step="1" value={props.difficulty.optionCount} onChange={(event) => props.onDifficultyChange({ ...props.difficulty, optionCount: Number(event.target.value) as OptionCount })} />
            </label>
            <label>
              Расстояние вариантов: <output>{props.difficulty.minDiatonicDistance} ступ.</output>
              <input type="range" min="1" max="4" step="1" value={props.difficulty.minDiatonicDistance} onChange={(event) => props.onDifficultyChange({ ...props.difficulty, minDiatonicDistance: Number(event.target.value) as DiatonicDistance })} />
            </label>
            <label>
              Знаков при ключе: <output>{props.difficulty.maxKeySignatureFifths === 0 ? "нет" : `до ${props.difficulty.maxKeySignatureFifths}`}</output>
              <input type="range" min="0" max="7" step="1" value={props.difficulty.maxKeySignatureFifths} onChange={(event) => props.onDifficultyChange({ ...props.difficulty, maxKeySignatureFifths: Number(event.target.value) as KeySignatureCount })} />
            </label>
            <CheckChip checked={props.difficulty.allowWrittenAccidentals} label="Случайные ♮ ♯ ♭" onChange={() => props.onDifficultyChange({ ...props.difficulty, allowWrittenAccidentals: !props.difficulty.allowWrittenAccidentals })} />
          </div>
        </section>

        <fieldset className="setting-section">
          <legend>Что дано</legend>
          <div className="check-grid representation-checks">
            {REPRESENTATIONS.map((value) => <CheckChip key={value} checked={props.sources.includes(value)} label={REPRESENTATION_LABELS[value]} onChange={() => props.onToggleSource(value)} />)}
          </div>
        </fieldset>

        <fieldset className="setting-section">
          <legend>Что отгадываем</legend>
          <div className="check-grid representation-checks">
            {REPRESENTATIONS.map((value) => <CheckChip key={value} checked={props.targets.includes(value)} label={REPRESENTATION_LABELS[value]} onChange={() => props.onToggleTarget(value)} />)}
          </div>
        </fieldset>

        <fieldset className="setting-section">
          <legend>Ключи</legend>
          <div className="check-grid clef-checks">
            {CLEFS.map((value) => <CheckChip key={value} checked={props.clefs.includes(value)} label={CLEF_LABELS[value]} onChange={() => props.onToggleClef(value)} />)}
          </div>
        </fieldset>

        <fieldset className="setting-section">
          <legend>Подсказки</legend>
          <div className="hint-toggles">
            <CheckChip checked={props.hints.keyboardNoteLabels} label="Ноты на клавишах" onChange={() => props.onHintChange("keyboardNoteLabels", !props.hints.keyboardNoteLabels)} />
            <CheckChip checked={props.hints.keyboardOctaveLabels} label="Названия октав" onChange={() => props.onHintChange("keyboardOctaveLabels", !props.hints.keyboardOctaveLabels)} />
            <CheckChip checked={props.hints.clefGuide} label="Опорные ноты ключей" onChange={() => props.onHintChange("clefGuide", !props.hints.clefGuide)} />
          </div>
        </fieldset>

        <fieldset className="setting-section">
          <legend>Поведение</legend>
          <CheckChip checked={props.autoAdvance} label="Автопереход через 1 секунду" onChange={() => props.onAutoAdvanceChange(!props.autoAdvance)} />
        </fieldset>

        <div className="setting-section naming-note">
          <strong>Названия одновременно</strong>
          <span>Русские слоги + немецкая буквенная система</span>
        </div>

        <div className="setting-section midi-setting">{props.midiControl}</div>
      </div>
    </details>
  );
}
