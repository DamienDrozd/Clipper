import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const count = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { video: { count: (...args: unknown[]) => count(...args) } } }));

const { VideoDeletedError, watchDeletion } = await import("./cancellation");

describe("watchDeletion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    count.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("annule le signal dès que la vidéo disparaît de la base", async () => {
    count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const watcher = watchDeletion("v1", 1000);

    await vi.advanceTimersByTimeAsync(1000);
    expect(watcher.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(watcher.signal.aborted).toBe(true);
    expect(watcher.signal.reason).toBeInstanceOf(VideoDeletedError);
    expect(() => watcher.signal.throwIfAborted()).toThrow(VideoDeletedError);
  });

  it("ignore une erreur de base passagère", async () => {
    count.mockRejectedValueOnce(new Error("connexion perdue")).mockResolvedValue(1);
    const watcher = watchDeletion("v1", 1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(watcher.signal.aborted).toBe(false);
    watcher.stop();
  });

  it("cesse d'interroger la base après stop()", async () => {
    count.mockResolvedValue(1);
    const watcher = watchDeletion("v1", 1000);
    await vi.advanceTimersByTimeAsync(1000);
    watcher.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(count).toHaveBeenCalledTimes(1);
  });
});
