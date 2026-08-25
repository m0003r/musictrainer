import { useEffect, useRef, useState, type ReactNode } from "react";
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

export function trappedFocusIndex(activeIndex: number, focusableCount: number, backwards: boolean): number | null {
  if (focusableCount === 0) return null;
  if (activeIndex < 0) return backwards ? focusableCount - 1 : 0;
  if (backwards && activeIndex === 0) return focusableCount - 1;
  if (!backwards && activeIndex === focusableCount - 1) return 0;
  return null;
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
  const [open, setOpen] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const preset = difficultyPreset(props.level);

  useEffect(() => {
    if (!open) return;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const containDrawerFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const drawer = drawerRef.current;
      if (!drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )).filter((element) => element.getAttribute("aria-hidden") !== "true");
      const targetIndex = trappedFocusIndex(focusable.indexOf(document.activeElement as HTMLElement), focusable.length, event.shiftKey);
      if (targetIndex === null) return;
      event.preventDefault();
      (focusable[targetIndex] ?? drawer).focus();
    };

    document.addEventListener("keydown", containDrawerFocus);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener("keydown", containDrawerFocus);
      launcherRef.current?.focus();
    };
  }, [open]);

  return (
    <>
      <button ref={launcherRef} type="button" className="settings-launcher" aria-expanded={open} aria-controls="practice-settings" onClick={() => setOpen(true)}>
        <span>Настройки</span>
        <small>{props.customDifficulty ? "Своя сложность" : `Уровень ${props.level}`} · {props.directionCount} связей · {props.clefs.length} ключей{props.pendingNextQuestion ? " · применится дальше" : ""}</small>
      </button>
      {open && <button type="button" className="settings-backdrop" tabIndex={-1} aria-label="Закрыть настройки" onClick={() => setOpen(false)} />}
      <aside ref={drawerRef} id="practice-settings" className={`setup-panel${open ? " is-open" : ""}`} role="dialog" aria-modal="true" aria-labelledby="practice-settings-title" aria-hidden={!open} inert={open ? undefined : true} tabIndex={-1}>
        <header className="settings-drawer-heading">
          <div><strong id="practice-settings-title">Настройки практики</strong><small>Изменения содержания — со следующего примера</small></div>
          <button ref={closeButtonRef} type="button" aria-label="Закрыть настройки" onClick={() => setOpen(false)}>×</button>
        </header>
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
      </aside>
    </>
  );
}
