import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DIRECTIONS, REPRESENTATIONS, createQuestion, difficultyPreset, directionKey,
  diatonicIndex, directionsForSelections, formatDirection, formatKeySignature, formatNoteName, isCorrectAnswer,
  noteFromDiatonicIndex, notesForClefDifficulty, type Clef, type DifficultyLevel, type DifficultySettings,
  randomKeyFifths, type Note, type Question, type Representation
} from "@music-trainer/core";
import { configurePlayback, disposeAudio, playNote, playSequence, type PlaybackMode, type SequencePlayback } from "./audio.js";
import { ClefGuide } from "./components/ClefGuide.js";
import { NotationCard } from "./components/NotationCard.js";
import { PianoKeyboard } from "./components/PianoKeyboard.js";
import { PracticeSettings, type HintSettings } from "./components/PracticeSettings.js";
import { RepresentationView } from "./components/RepresentationView.js";
import { startAnswerFeedback, type AnswerFeedback } from "./feedback.js";
import { chooseMixedDirection, recordSessionAttempt, type SessionStats } from "./session.js";
import { soundChoiceKeyboardAction } from "./soundChoice.js";
import { useMidi } from "./useMidi.js";
import {
  LocalStoreError, createProfile, getActiveProfile, getProgress, leaveProfile, listProfiles,
  loadSettings, recordAttempt, resolveInitialDifficulty, saveSettings, selectProfile,
  type LocalProfile, type LocalProfileSummary, type LocalTrainerSettings
} from "./localStore.js";

type InputMethod = "pointer" | "keyboard" | "midi";
const MIDI_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"] as const;
function scientificMidiName(midi: number): string {
  return `${MIDI_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
function scientificMidiSequence(midis: readonly number[]): string {
  return midis.map(scientificMidiName).join(" · ");
}
function formattedNoteSequence(notes: readonly Note[]): string {
  return notes.map((note) => formatNoteName(note, "all")).join(" · ");
}
function toggleInList<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
function keyboardRangeForNotes(notes: readonly Note[]): { minMidi: number; maxMidi: number } {
  const first = notes[0];
  const last = notes[notes.length - 1];
  if (!first || !last) throw new Error("Keyboard range requires at least one note");
  return {
    minMidi: Math.max(0, noteFromDiatonicIndex(diatonicIndex(first) - 1).midi),
    maxMidi: Math.min(127, noteFromDiatonicIndex(diatonicIndex(last) + 1).midi)
  };
}
function speedTrend(stats: SessionStats[string]): string | null {
  const recent = stats.recentCorrectResponseTimeMs;
  const previous = stats.previousCorrectResponseTimeMs;
  if (!recent || !previous) return null;
  const change = recent / previous - 1;
  if (change <= -0.05) return `быстрее на ${Math.round(Math.abs(change) * 100)}%`;
  if (change >= 0.05) return `медленнее на ${Math.round(change * 100)}%`;
  return "скорость стабильна";
}

function ProgressPanel({ stats }: { stats: SessionStats }) {
  return <details className="progress-panel">
    <summary>Карта 12 связей</summary>
    <p>Скорость сравнивается только с вашей собственной предыдущей практикой.</p>
    <div className="progress-grid">{DIRECTIONS.map((direction) => {
      const current = stats[directionKey(direction)];
      const trend = current ? speedTrend(current) : null;
      return <div className="progress-row" key={directionKey(direction)}>
        <span>{formatDirection(direction)}</span>
        {current ? <><strong>{Math.round((current.correct / current.attempts) * 100)}%</strong><small>
          {current.correct}/{current.attempts}
          {current.averageResponseTimeMs ? ` · ${(current.averageResponseTimeMs / 1000).toFixed(1)} с` : ""}
          {trend ? ` · ${trend}` : ""}
        </small></> : <small>ещё не проверено</small>}
      </div>;
    })}</div>
  </details>;
}

function Trainer({ profile, onLeaveProfile }: { profile: LocalProfile; onLeaveProfile: () => void }) {
  const [stored] = useState(() => {
    try { return { settings: loadSettings(profile.id), stats: getProgress(profile.id).directions as SessionStats, error: "" }; }
    catch { return { settings: null, stats: {} as SessionStats, error: "Локальное хранилище недоступно: изменения этой сессии могут не сохраниться." }; }
  });
  const initialDifficulty = resolveInitialDifficulty(stored.settings);
  const [level, setLevel] = useState<DifficultyLevel>(stored.settings?.level ?? 1);
  const [customDifficulty, setCustomDifficulty] = useState(stored.settings?.customDifficulty ?? false);
  const [difficulty, setDifficulty] = useState<DifficultySettings>(initialDifficulty);
  const [sources, setSources] = useState<Representation[]>(stored.settings?.sources ?? [...REPRESENTATIONS]);
  const [targets, setTargets] = useState<Representation[]>(stored.settings?.targets ?? [...REPRESENTATIONS]);
  const [selectedClefs, setSelectedClefs] = useState<Clef[]>(stored.settings?.selectedClefs ?? ["treble"]);
  const [hints, setHints] = useState<HintSettings>(stored.settings?.hints ?? { keyboardNoteLabels: false, keyboardOctaveLabels: true, clefGuide: false });
  const [stats, setStats] = useState<SessionStats>(stored.stats);
  const [question, setQuestion] = useState<Question>(() => createQuestion({
    direction: DIRECTIONS[0]!, clef: "treble", nameSystem: "all",
    notes: notesForClefDifficulty("treble", initialDifficulty.ledgerLines),
    optionCount: initialDifficulty.optionCount, minDiatonicDistance: initialDifficulty.minDiatonicDistance,
    notesPerQuestion: initialDifficulty.notesPerQuestion, maxMelodicDistance: initialDifficulty.maxMelodicDistance,
    keyFifths: 0, allowWrittenAccidentals: false
  }));
  const [keyboardRange, setKeyboardRange] = useState(() => {
    const notes = notesForClefDifficulty("treble", initialDifficulty.ledgerLines);
    return keyboardRangeForNotes(notes);
  });
  const [answeredMidis, setAnsweredMidis] = useState<number[] | null>(null);
  const [keyboardInput, setKeyboardInput] = useState<number[]>([]);
  const keyboardInputRef = useRef<number[]>([]);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [storageWarning, setStorageWarning] = useState(stored.error);
  const [progressReady, setProgressReady] = useState(false);
  const [promptPresented, setPromptPresented] = useState(false);
  const [correctionComplete, setCorrectionComplete] = useState(true);
  const [inputNotice, setInputNotice] = useState("");
  const [configNotice, setConfigNotice] = useState("");
  const [activeSoundOption, setActiveSoundOption] = useState<number | null>(null);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(stored.settings?.playbackMode === "midi" ? "webaudio" : stored.settings?.playbackMode ?? "webaudio");
  const [autoAdvance, setAutoAdvance] = useState(stored.settings?.autoAdvance ?? false);
  const [questionAutoAdvance, setQuestionAutoAdvance] = useState(stored.settings?.autoAdvance ?? false);
  const [settingsPending, setSettingsPending] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const activePlaybackRef = useRef<SequencePlayback | null>(null);
  const answerFeedbackRef = useRef<AnswerFeedback | null>(null);

  const enabledDirections = useMemo(() => directionsForSelections(sources, targets), [sources, targets]);
  const totalAttempts = Object.values(stats).reduce((sum, value) => sum + value.attempts, 0);
  const totalCorrect = Object.values(stats).reduce((sum, value) => sum + value.correct, 0);
  const keyboardCorrectionPending = answeredMidis !== null && lastCorrect === false
    && question.direction.target === "keyboard" && !correctionComplete;

  const cancelAnswerFeedback = useCallback(() => {
    answerFeedbackRef.current?.cancel();
    answerFeedbackRef.current = null;
    activePlaybackRef.current?.cancel();
    activePlaybackRef.current = null;
  }, []);
  const playSequenceNow = useCallback((midis: readonly number[], gapMs = 520) => {
    activePlaybackRef.current?.cancel();
    const playback = playSequence(midis, gapMs);
    activePlaybackRef.current = playback;
    return playback;
  }, []);

  const makeNextQuestion = useCallback((nextStats: SessionStats, previousMidi?: number) => {
    cancelAnswerFeedback();
    if (enabledDirections.length === 0 || selectedClefs.length === 0) return;
    const direction = chooseMixedDirection(nextStats, Math.random, enabledDirections);
    const clef = selectedClefs[Math.floor(Math.random() * selectedClefs.length)] ?? selectedClefs[0]!;
    const keyFifths = randomKeyFifths(difficulty.maxKeySignatureFifths, Math.random);
    const pitchOnlySource = direction.source === "keyboard" || direction.source === "sound";
    const spellingTarget = direction.target === "notation" || direction.target === "name";
    try {
      const notePool = notesForClefDifficulty(clef, difficulty.ledgerLines);
      const nextQuestion = createQuestion({
        direction, clef, nameSystem: "all", notes: notePool,
        optionCount: difficulty.optionCount, minDiatonicDistance: difficulty.minDiatonicDistance,
        notesPerQuestion: difficulty.notesPerQuestion, maxMelodicDistance: difficulty.maxMelodicDistance,
        keyFifths,
        allowWrittenAccidentals: difficulty.allowWrittenAccidentals && !(pitchOnlySource && spellingTarget),
        ...(previousMidi === undefined ? {} : { previousMidi })
      });
      setQuestion(nextQuestion);
      setQuestionAutoAdvance(autoAdvance);
      setKeyboardRange(keyboardRangeForNotes(notePool));
      setConfigNotice("");
      setSettingsPending(false);
      keyboardInputRef.current = [];
      setAnsweredMidis(null); setKeyboardInput([]); setLastCorrect(null); setCorrectionComplete(true); setInputNotice(""); setActiveSoundOption(null);
      const immediate = direction.source === "name" || direction.source === "keyboard";
      setPromptPresented(immediate);
      startedAtRef.current = immediate ? performance.now() : null;
    } catch (error) {
      setConfigNotice(error instanceof Error ? error.message : "Эта комбинация сложности недоступна");
    }
  }, [autoAdvance, cancelAnswerFeedback, difficulty, enabledDirections, selectedClefs]);

  const makeNextQuestionRef = useRef(makeNextQuestion);
  useEffect(() => { makeNextQuestionRef.current = makeNextQuestion; }, [makeNextQuestion]);

  useEffect(() => {
    setStats(stored.stats);
    makeNextQuestion(stored.stats, question.note.midi);
    setProgressReady(true);
  }, [profile.id]);
  useEffect(() => {
    const snapshot: LocalTrainerSettings = {
      level, customDifficulty, difficulty, sources, targets, selectedClefs, hints, autoAdvance, playbackMode
    };
    try {
      saveSettings(snapshot, profile.id);
      setStorageWarning("");
    } catch {
      setStorageWarning("Не удалось сохранить настройки локально. Текущая сессия продолжит работать.");
    }
  }, [autoAdvance, customDifficulty, difficulty, hints, level, playbackMode, profile.id, selectedClefs, sources, targets]);
  useEffect(() => () => { cancelAnswerFeedback(); disposeAudio(); }, [cancelAnswerFeedback]);
  useEffect(() => {
    let hiddenAt: number | null = null;
    const handleVisibility = () => {
      if (document.hidden) hiddenAt = performance.now();
      else if (hiddenAt !== null && startedAtRef.current !== null) {
        startedAtRef.current += performance.now() - hiddenAt; hiddenAt = null;
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const markPromptPresented = useCallback(() => {
    setPromptPresented((current) => {
      if (current) return current;
      startedAtRef.current = performance.now(); return true;
    });
  }, []);

  const submitAnswer = useCallback((midis: readonly number[], inputMethod: InputMethod) => {
    if (!progressReady || !promptPresented || startedAtRef.current === null || answeredMidis !== null) return;
    const answer = [...midis];
    const correct = isCorrectAnswer(question, answer);
    const responseTimeMs = Math.max(0, Math.round(performance.now() - startedAtRef.current));
    keyboardInputRef.current = [];
    setAnsweredMidis(answer); setKeyboardInput([]); setLastCorrect(correct);
    setCorrectionComplete(correct || question.direction.target !== "keyboard");
    let nextStats = recordSessionAttempt(stats, question.direction, correct, responseTimeMs);
    setInputNotice(""); setStats(nextStats);
    cancelAnswerFeedback();
    answerFeedbackRef.current = startAnswerFeedback({
      direction: question.direction,
      correct,
      answeredMidis: answer,
      expectedMidis: question.sequence.map((note) => note.midi),
      autoAdvance: questionAutoAdvance,
      playSequence: playSequenceNow,
      onAdvance: () => makeNextQuestionRef.current(nextStats, question.note.midi)
    });
    try {
      recordAttempt({
        questionId: question.id, source: question.direction.source, target: question.direction.target,
        clef: question.clef, nameSystem: question.nameSystem, keyFifths: question.keyFifths,
        expectedSequence: question.sequence.map((note, index) => ({
          ...note, writtenAccidental: question.writtenAccidentals[index] ?? null
        })),
        answeredSequence: answer, correct, responseTimeMs, inputMethod, occurredAt: new Date().toISOString()
      }, profile.id);
      nextStats = getProgress(profile.id).directions as SessionStats;
      setStats(nextStats); setStorageWarning("");
    } catch {
      setStorageWarning("Ответ учтён в текущей сессии, но не сохранился в localStorage.");
    }
  }, [answeredMidis, cancelAnswerFeedback, playSequenceNow, profile.id, progressReady, promptPresented, question, questionAutoAdvance, stats]);

  const commitKeyboard = useCallback((midi: number, inputMethod: InputMethod) => {
    if (keyboardCorrectionPending) {
      const currentInput = keyboardInputRef.current;
      const expected = question.sequence[currentInput.length]?.midi;
      if (midi !== expected) { keyboardInputRef.current = []; setKeyboardInput([]); setInputNotice("Начните последовательность ещё раз: правильные клавиши выделены зелёным."); playNote(midi); return; }
      const nextInput = [...currentInput, midi];
      keyboardInputRef.current = nextInput;
      playNote(midi);
      if (nextInput.length === question.sequence.length) {
        keyboardInputRef.current = []; setKeyboardInput([]); setCorrectionComplete(true); setInputNotice("Правильная последовательность сыграна.");
      } else {
        setKeyboardInput(nextInput); setInputNotice(`Коррекция: ${nextInput.length} из ${question.sequence.length}`);
      }
      return;
    }
    if (answeredMidis !== null) return;
    const nextInput = [...keyboardInputRef.current, midi];
    keyboardInputRef.current = nextInput;
    playNote(midi);
    if (nextInput.length === question.sequence.length) submitAnswer(nextInput, inputMethod);
    else { setKeyboardInput(nextInput); setInputNotice(`Сыграно ${nextInput.length} из ${question.sequence.length}`); }
  }, [answeredMidis, keyboardCorrectionPending, question.sequence, submitAnswer]);
  const auditionSoundCandidate = useCallback((index: number) => {
    if (answeredMidis !== null) return;
    setActiveSoundOption(index); setInputNotice("");
    playSequenceNow(question.optionSequences[index]?.map((note) => note.midi) ?? []);
  }, [answeredMidis, playSequenceNow, question.optionSequences]);
  const confirmSoundCandidate = useCallback((method: InputMethod) => {
    if (activeSoundOption === null) { setInputNotice("Сначала прослушайте один из вариантов."); return; }
    const option = question.optionSequences[activeSoundOption];
    if (option) submitAnswer(option.map((note) => note.midi), method);
  }, [activeSoundOption, question.optionSequences, submitAnswer]);
  const handleMidiNote = useCallback((midi: number) => {
    if (!promptPresented) {
      setInputNotice("MIDI-нота получена. Сначала предъявите исходный звук или дождитесь записи.");
      return;
    }
    if (question.direction.target === "keyboard") {
      if (answeredMidis === null || keyboardCorrectionPending) commitKeyboard(midi, "midi");
    } else if (question.direction.target === "sound" && answeredMidis === null) commitKeyboard(midi, "midi");
    else setInputNotice(`MIDI ${midi} получен. В этом вопросе ответ выбирается карточкой.`);
  }, [answeredMidis, commitKeyboard, keyboardCorrectionPending, promptPresented, question.direction.target]);
  const midi = useMidi(handleMidiNote);
  useEffect(() => configurePlayback(playbackMode, midi.selectedOutput), [midi.selectedOutput, playbackMode]);
  useEffect(() => {
    if (playbackMode === "midi" && midi.selectedOutput === null) setPlaybackMode("webaudio");
  }, [midi.selectedOutput, playbackMode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!progressReady || !promptPresented || (answeredMidis !== null && !keyboardCorrectionPending)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      if (question.direction.target === "sound") {
        const action = soundChoiceKeyboardAction(event.key, question.optionSequences, activeSoundOption);
        if (action === null) return;
        event.preventDefault();
        if (action.kind === "audition") auditionSoundCandidate(action.optionIndex);
        else confirmSoundCandidate("keyboard");
        return;
      }
      if (question.direction.target === "keyboard" || !/^[1-6]$/.test(event.key)) return;
      const option = question.optionSequences[Number(event.key) - 1];
      if (option) { event.preventDefault(); submitAnswer(option.map((note) => note.midi), "keyboard"); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSoundOption, answeredMidis, auditionSoundCandidate, confirmSoundCandidate, keyboardCorrectionPending, progressReady, promptPresented, question, submitAnswer]);

  function toggleSource(value: Representation) {
    const next = toggleInList(sources, value);
    if (next.length === 0 || directionsForSelections(next, targets).length === 0) { setConfigNotice("Должна остаться хотя бы одна связь между разными представлениями."); return; }
    setSources(next); setSettingsPending(true);
  }
  function toggleTarget(value: Representation) {
    const next = toggleInList(targets, value);
    if (next.length === 0 || directionsForSelections(sources, next).length === 0) { setConfigNotice("Должна остаться хотя бы одна связь между разными представлениями."); return; }
    setTargets(next); setSettingsPending(true);
  }
  function toggleClef(value: Clef) {
    const next = toggleInList(selectedClefs, value);
    if (next.length === 0) { setConfigNotice("Оставьте хотя бы один ключ."); return; }
    setSelectedClefs(next); setSettingsPending(true);
  }
  function setPreset(next: DifficultyLevel) { setLevel(next); setCustomDifficulty(false); setDifficulty(difficultyPreset(next).settings); setSettingsPending(true); }
  function setCustom(next: DifficultySettings) { setCustomDifficulty(true); setDifficulty(next); setSettingsPending(true); }
  function setHint(name: keyof HintSettings, enabled: boolean) { setHints((current) => ({ ...current, [name]: enabled })); }
  function setAutoAdvanceForNextQuestion(enabled: boolean) { setAutoAdvance(enabled); setSettingsPending(true); }

  if (!progressReady) return <main className="auth-shell"><p>Загружаем прогресс…</p></main>;

  const selectedMidiInput = midi.inputs.find((input) => input.id === midi.selectedInputId);
  const otherMidiInputCount = Math.max(0, midi.inputs.length - (selectedMidiInput ? 1 : 0));
  const midiControl = <div className="midi-control"><span>MIDI-ввод</span>{midi.status === "connected"
    ? <span className="midi-status is-connected">{selectedMidiInput?.name ?? "Подключено"}{otherMidiInputCount > 0 ? ` · ещё ${otherMidiInputCount}` : ""}{midi.lastNote === null ? "" : ` · получено MIDI ${midi.lastNote}`}</span>
    : midi.status === "no-devices" ? <span className="midi-status">Доступ есть, устройство не найдено</span>
      : <button type="button" onClick={() => void midi.connect()} disabled={midi.status === "unsupported" || midi.status === "connecting"}>
        {midi.status === "unsupported" ? "Не поддерживается" : midi.status === "connecting" ? "Подключение…" : midi.status === "denied" || midi.status === "error" ? "Повторить подключение" : "Подключить"}
      </button>}
    {midi.errorMessage && <span className="midi-error" role="status">{midi.errorMessage}</span>}
    {midi.inputs.length > 1 && <select aria-label="MIDI-устройство ввода" value={midi.selectedInputId ?? ""} onChange={(event) => midi.selectInput(event.target.value || null)}>
      {midi.inputs.map((input) => <option value={input.id} key={input.id}>{input.name ?? `MIDI ${input.id}`}</option>)}
    </select>}
    <span>Воспроизведение</span>
    <div className="playback-toggle" role="group" aria-label="Способ воспроизведения звука">
      <button type="button" aria-pressed={playbackMode === "webaudio"} onClick={() => setPlaybackMode("webaudio")}>Web Audio</button>
      <button type="button" aria-pressed={playbackMode === "midi"} disabled={midi.selectedOutput === null} onClick={() => setPlaybackMode("midi")}>MIDI OUT</button>
    </div>
    {midi.outputs.length > 1 && <select aria-label="MIDI-устройство воспроизведения" value={midi.selectedOutputId ?? ""} onChange={(event) => midi.selectOutput(event.target.value)}>
      {midi.outputs.map((output) => <option value={output.id} key={output.id}>{output.name}</option>)}
    </select>}
    {midi.outputs.length === 0 && midi.status !== "idle" && midi.status !== "connecting" && <small className="midi-output-note">MIDI-выход не найден; звучит Web Audio.</small>}
  </div>;

  return <main className="app-shell trainer-shell">
    <header className="hero compact-hero"><div><p className="eyebrow">Самостоятельная практика между уроками</p><h1>Связи нот</h1><p className="lead">Запись · название · клавиатура · звучание</p></div>
      <div className="hero-side"><div className="user-chip"><span>{profile.name}</span><button type="button" onClick={() => void onLeaveProfile()}>Сменить профиль</button></div>
        <div className="session-score" aria-label="Накопленный результат"><strong>{totalCorrect}/{totalAttempts}</strong><span>{totalAttempts === 0 ? "Начните с первой связи" : `${Math.round((totalCorrect / totalAttempts) * 100)}% точно`}</span></div>
      </div></header>

    <div className="trainer-workspace">
      <PracticeSettings level={level} customDifficulty={customDifficulty} difficulty={difficulty} sources={sources} targets={targets} clefs={selectedClefs} hints={hints} autoAdvance={autoAdvance} pendingNextQuestion={settingsPending}
        directionCount={enabledDirections.length} midiControl={midiControl} onLevelChange={setPreset} onDifficultyChange={setCustom}
        onToggleSource={toggleSource} onToggleTarget={toggleTarget} onToggleClef={toggleClef}
        onHintChange={setHint} onAutoAdvanceChange={setAutoAdvanceForNextQuestion} />

      <div className="practice-column">
        {configNotice && <p className="config-notice" role="status">{configNotice}</p>}
        {hints.clefGuide && <ClefGuide clefs={[question.clef]} />}
        <section className="exercise-card">
          <div className="exercise-heading"><span className="direction-badge">{formatDirection(question.direction)}</span><span>{question.direction.target === "keyboard" ? "Нажмите любую клавишу" : question.direction.target === "sound" ? "Сравните и подтвердите звук" : "Выберите правильный вариант"}</span></div>
          <div className={`exercise-body target-${question.direction.target}`}>
            <div className="prompt-card"><p>Дано</p><div className="notation-context"><span>{formatKeySignature(question.keyFifths)}</span>{question.writtenAccidentals.some((value) => value !== null) && <span>Случайный знак в примере</span>}</div><RepresentationView representation={question.direction.source} note={question.sequence} clef={question.clef} nameSystem="all"
              keyFifths={question.keyFifths} writtenAccidental={question.writtenAccidentals}
              keyboardRange={keyboardRange} showKeyboardNoteLabels={hints.keyboardNoteLabels} showKeyboardOctaveLabels={hints.keyboardOctaveLabels}
              onPlaySequence={playSequenceNow} onPresented={markPromptPresented} />
              {!promptPresented && question.direction.source === "sound" && <span className="activation-hint">Прослушайте звук, чтобы начать отсчёт.</span>}</div>
            <div className="answer-column">{question.direction.target === "keyboard"
              ? <KeyboardAnswer question={question} range={keyboardRange} answeredMidis={answeredMidis} keyboardInput={keyboardInput} correctionPending={keyboardCorrectionPending} promptPresented={promptPresented} hints={hints} onCommit={(midiValue) => commitKeyboard(midiValue, "pointer")} />
              : question.direction.target === "sound"
                ? <SoundAnswer question={question} answeredMidis={answeredMidis} activeOption={activeSoundOption} promptPresented={promptPresented} onAudition={auditionSoundCandidate} onConfirm={() => confirmSoundCandidate("pointer")} />
                : <OptionAnswer question={question} answeredMidis={answeredMidis} promptPresented={promptPresented} range={keyboardRange} hints={hints} onSubmit={(midis) => submitAnswer(midis, "pointer")} />}
              {inputNotice && <span className="input-notice" role="status">{inputNotice}</span>}
            </div>
          </div>

          {lastCorrect !== null && <div className={`feedback ${lastCorrect ? "is-correct" : "is-wrong"}`} role="status"><div><strong>{lastCorrect ? "Верно" : "Пока нет"}</strong>
            <span>{lastCorrect ? `Правильно: ${formattedNoteSequence(question.sequence)}.` : `Ваш ответ: ${scientificMidiSequence(answeredMidis!)}. Сначала прозвучал ваш вариант, затем правильная последовательность — ${formattedNoteSequence(question.sequence)}.`}</span></div>
            <div className="feedback-actions">{!lastCorrect && <button type="button" onClick={() => playSequenceNow(answeredMidis!)}>Ваш ответ</button>}<button type="button" onClick={() => playSequenceNow(question.sequence.map((note) => note.midi))}>Правильно</button>
              {keyboardCorrectionPending ? <span className="correction-hint">Следующий вопрос откроется после правильного нажатия.</span> : <button type="button" className="next-button" onClick={() => makeNextQuestion(stats, question.note.midi)}>{lastCorrect && questionAutoAdvance ? "Следующая сейчас · авто 1 с" : "Следующая связь"}</button>}</div>
          </div>}

          {lastCorrect !== null && <div className="answer-map">
            <div><span>Запись</span><NotationCard note={question.sequence} clef={question.clef} keyFifths={question.keyFifths} writtenAccidental={question.writtenAccidentals} /></div>
            <div><span>Название</span><RepresentationView representation="name" note={question.sequence} clef={question.clef} nameSystem="all" keyFifths={question.keyFifths} writtenAccidental={question.writtenAccidentals} /></div>
            <div><span>Клавиатура</span><PianoKeyboard mode="review" correctMidis={question.sequence.map((note) => note.midi)} range={keyboardRange} compact showNoteLabels={hints.keyboardNoteLabels} showOctaveLabels={hints.keyboardOctaveLabels} /></div>
            <div><span>Звучание</span><button type="button" onClick={() => playSequenceNow(question.sequence.map((note) => note.midi))}>Прослушать</button></div>
          </div>}
          {storageWarning && <p className="sync-warning" role="status">{storageWarning}</p>}
        </section>
        <ProgressPanel stats={stats} />
        <footer><p>Узнавание закрепляет связи. Продуктивная запись нот — следующий этап по Хвостенко.</p></footer>
      </div>
    </div>
  </main>;
}

function sameMidis(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((midi, index) => midi === right[index]);
}
interface AnswerCommon { question: Question; answeredMidis: number[] | null; promptPresented: boolean; }
function KeyboardAnswer({ question, range, answeredMidis, keyboardInput, correctionPending, promptPresented, hints, onCommit }: AnswerCommon & { range: { minMidi: number; maxMidi: number }; keyboardInput: readonly number[]; correctionPending: boolean; hints: HintSettings; onCommit: (midi: number) => void }) {
  const count = question.sequence.length;
  return <div className="keyboard-answer-surface"><div className="keyboard-answer-copy"><strong>{correctionPending ? "Сыграйте правильную последовательность" : count === 1 ? "Вся клавиатура активна" : `Сыграйте ${count} нот по порядку`}</strong><span>{correctionPending ? `Коррекция не считается новой попыткой · ${keyboardInput.length}/${count}` : `Мышь, касание или MIDI · ${keyboardInput.length}/${count}`}</span></div>
    <PianoKeyboard mode="answer" range={range} selectedMidis={answeredMidis ?? keyboardInput} correctMidis={answeredMidis === null ? null : question.sequence.map((note) => note.midi)} correctionOnly={correctionPending}
      focusMidi={correctionPending ? question.sequence[keyboardInput.length]?.midi : undefined}
      disabled={!promptPresented || (answeredMidis !== null && !correctionPending)} showNoteLabels={hints.keyboardNoteLabels} showOctaveLabels={hints.keyboardOctaveLabels} onCommit={onCommit} />
  </div>;
}
function SoundAnswer({ question, answeredMidis, activeOption, promptPresented, onAudition, onConfirm }: AnswerCommon & { activeOption: number | null; onAudition: (index: number) => void; onConfirm: () => void }) {
  return <div className="sound-choice-surface"><div className="sound-choice-copy"><strong>Сравните {question.optionSequences.length} {question.sequence.length === 1 ? "звука" : "последовательности"}</strong><span>Цифры 1–{question.optionSequences.length} прослушивают. Enter подтверждает вариант.</span></div>
    <div className="sound-choice-grid" aria-label="Звуковые варианты ответа">{question.optionSequences.map((option, index) => {
      const optionMidis = option.map((note) => note.midi);
      const resultClass = answeredMidis === null ? activeOption === index ? "is-active-choice" : "" : isCorrectAnswer(question, optionMidis) ? "is-correct" : sameMidis(answeredMidis, optionMidis) ? "is-wrong" : "is-muted";
      return <button type="button" className={`sound-choice ${resultClass}`} key={`${optionMidis.join("-")}-${index}`} aria-label={`Вариант ${index + 1}: прослушать`} aria-pressed={activeOption === index}
        onClick={() => onAudition(index)} disabled={!promptPresented || answeredMidis !== null}><span className="sound-choice-number">{index + 1}</span><span className="sound-choice-icon" aria-hidden="true">♪</span><span>{activeOption === index ? "Ещё раз" : "Слушать"}</span></button>;
    })}</div><button type="button" className="sound-choice-confirm" onClick={onConfirm} disabled={!promptPresented || activeOption === null || answeredMidis !== null}>{activeOption === null ? "Сначала прослушайте вариант" : `Выбрать вариант ${activeOption + 1}`}</button>
  </div>;
}
function OptionAnswer({ question, answeredMidis, promptPresented, range, hints, onSubmit }: AnswerCommon & { range: { minMidi: number; maxMidi: number }; hints: HintSettings; onSubmit: (midis: readonly number[]) => void }) {
  return <div className={`options-grid options-${question.optionSequences.length}`} aria-label="Варианты ответа">{question.optionSequences.map((option, index) => {
    const optionMidis = option.map((note) => note.midi);
    const resultClass = answeredMidis === null ? "" : isCorrectAnswer(question, optionMidis) ? "is-correct" : sameMidis(answeredMidis, optionMidis) ? "is-wrong" : "is-muted";
    return <article className={`option-card ${resultClass}`} key={`${optionMidis.join("-")}-${index}`}><span className="option-number">{index + 1}</span>
      <RepresentationView representation={question.direction.target} note={option} clef={question.clef} nameSystem="all" keyFifths={question.keyFifths} keyboardRange={range} showKeyboardNoteLabels={hints.keyboardNoteLabels} showKeyboardOctaveLabels={hints.keyboardOctaveLabels} />
      <button type="button" onClick={() => onSubmit(optionMidis)} disabled={!promptPresented || answeredMidis !== null}>Выбрать</button></article>;
  })}</div>;
}

function ProfileScreen({ onSelected }: { onSelected: (profile: LocalProfile) => void }) {
  const [initialProfiles] = useState(() => {
    try { return { profiles: listProfiles(), error: "" }; }
    catch { return { profiles: [] as LocalProfileSummary[], error: "Локальное хранилище недоступно. Разрешите сайту сохранять данные в браузере." }; }
  });
  const [profiles, setProfiles] = useState<LocalProfileSummary[]>(initialProfiles.profiles);
  const [name, setName] = useState(""); const [error, setError] = useState(initialProfiles.error);
  function chooseProfile(profile: LocalProfile) {
    setError("");
    try { onSelected(selectProfile(profile.id)); }
    catch { setError("Не удалось открыть локальный профиль"); }
  }
  function createLocalProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    try { onSelected(createProfile(name)); }
    catch (cause) {
      try { setProfiles(listProfiles()); } catch { /* Keep the already visible in-memory list. */ }
      setError(cause instanceof LocalStoreError && cause.code === "duplicate_profile" ? "Профиль с таким именем уже есть" : "Не удалось создать локальный профиль");
    }
  }
  return <main className="auth-shell"><section className="profile-card"><p className="eyebrow">Локальная практика</p><h1>Связи нот</h1><p className="lead">Кто сегодня занимается?</p>
    <div className="profile-list" aria-label="Локальные профили">{profiles.map((item) => <button type="button" className="profile-tile" key={item.id} onClick={() => chooseProfile(item)}><span className="profile-avatar" aria-hidden="true">{item.name.trim().charAt(0).toLocaleUpperCase("ru")}</span><span className="profile-details"><strong>{item.name}</strong><small>{item.attempts === 0 ? "Новый профиль" : `${item.attempts} ответов`}</small></span><span className="profile-arrow" aria-hidden="true">→</span></button>)}</div>
    <form className="profile-create" onSubmit={createLocalProfile}><label>Новый профиль<span className="profile-create-row"><input type="text" maxLength={40} autoComplete="off" placeholder="Имя" value={name} onChange={(event) => setName(event.target.value)} required /><button type="submit" disabled={name.trim().length === 0}>Создать</button></span></label>{error && <p className="auth-error" role="alert">{error}</p>}</form><p className="local-note">Профили и прогресс хранятся в этом браузере и не требуют входа.</p>
  </section></main>;
}

export function App() {
  const [profile, setProfile] = useState<LocalProfile | null>(() => {
    try { return getActiveProfile(); } catch { return null; }
  });
  if (profile === null) return <ProfileScreen onSelected={setProfile} />;
  return <Trainer profile={profile} onLeaveProfile={() => { try { leaveProfile(); } finally { setProfile(null); } }} />;
}
