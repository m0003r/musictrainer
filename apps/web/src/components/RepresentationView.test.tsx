import { describe, expect, it, vi } from "vitest";
import { playSoundPrompt } from "./RepresentationView.js";

describe("sound representation presentation timing", () => {
  it("waits for the sequence onset callback before reporting presentation", () => {
    const onPresented = vi.fn();
    const onPlaySequence = vi.fn();

    playSoundPrompt([60, 64], onPresented, onPlaySequence);

    expect(onPresented).not.toHaveBeenCalled();
    expect(onPlaySequence).toHaveBeenCalledOnce();
    const [midis, onFirstNoteStarted] = onPlaySequence.mock.calls[0]!;
    expect(midis).toEqual([60, 64]);

    onFirstNoteStarted?.();
    expect(onPresented).toHaveBeenCalledOnce();
  });
});
