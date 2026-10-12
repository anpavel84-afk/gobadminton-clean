import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForegroundUpdates } from "../src/lib/foreground-updates";

describe("document foreground update ownership", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000); });
  afterEach(() => { vi.useRealTimers(); });
  it("shares one in-flight read and cached publication across subscribers, and disposes", async () => {
    const owner = new ForegroundUpdates(() => true);
    owner.session("actor-a");
    let resolve!: (r: { ok: true; status: number; data: number }) => void;
    const load = vi.fn(() => new Promise<{ ok: true; status: number; data: number }>(r => { resolve = r; }));
    const a = vi.fn(), b = vi.fn();
    const offA = owner.subscribe("dm:1", 3000, load, a);
    const offB = owner.subscribe("dm:1", 3000, load, b);
    await vi.advanceTimersByTimeAsync(0);
    owner.foreground(); owner.foreground(); owner.foreground();
    await vi.advanceTimersByTimeAsync(500);
    expect(load).toHaveBeenCalledTimes(1);
    resolve({ ok: true, status: 200, data: 7 });
    await vi.advanceTimersByTimeAsync(0);
    expect(a).toHaveBeenCalledWith({ ok: true, status: 200, data: 7 }); expect(b).toHaveBeenCalledWith({ ok: true, status: 200, data: 7 });
    offA(); offB();
    await vi.advanceTimersByTimeAsync(60000);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("pauses hidden/offline work and coalesces recovery events", async () => {
    let active = false;
    const owner = new ForegroundUpdates(() => active), load = vi.fn(async () => ({ ok: true as const, status: 200, data: 1 }));
    const off = owner.subscribe("dm", 3000, load, () => {});
    await vi.advanceTimersByTimeAsync(60000); expect(load).not.toHaveBeenCalled();
    active = true; owner.foreground(); owner.foreground(); owner.foreground();
    await vi.advanceTimersByTimeAsync(0); expect(load).toHaveBeenCalledTimes(1);
    off();
  });
  it("drops old actor completions and 401 clears all subscribers", async () => {
    const owner = new ForegroundUpdates(() => true); owner.session("a");
    let resolve!: (value: { ok: true; status: number; data: string }) => void;
    const receive = vi.fn();
    owner.subscribe("thread", 3000, () => new Promise<{ ok: true; status: number; data: string }>(r => { resolve = r; }), receive);
    await vi.advanceTimersByTimeAsync(0); owner.session("b"); receive.mockClear();
    resolve({ ok: true, status: 200, data: "private-a" }); await vi.advanceTimersByTimeAsync(0);
    expect(receive).not.toHaveBeenCalled();
    const privateB = vi.fn();
    owner.subscribe("other", 15000, async () => ({ ok: true, status: 200, data: "b" }), privateB);
    owner.subscribe("denied", 3000, async () => ({ ok: false, status: 401, error: "expired" }), () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(privateB).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, status: 401 }));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("respects Retry-After despite focus, and bounds a never-ending GET", async () => {
    const owner = new ForegroundUpdates(() => true);
    const load = vi.fn(async () => ({ ok: false as const, status: 429, error: "rate", retryAfterSeconds: 60 }));
    const off = owner.subscribe("rate", 3000, load, () => {});
    await vi.advanceTimersByTimeAsync(0); owner.foreground(); owner.invalidate();
    await vi.advanceTimersByTimeAsync(59999); expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(load).toHaveBeenCalledTimes(2); off();
    const receive = vi.fn();
    const dispose = owner.subscribe("hung", 3000, () => new Promise(() => {}), receive);
    await vi.advanceTimersByTimeAsync(10000);
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ ok: false, status: 0 })); dispose();
  });
  it("Inbox owns global counts while mounted, header resumes after unmount", async () => {
    const owner = new ForegroundUpdates(() => true), counts = vi.fn(async () => ({ ok: true as const, status: 200, data: 0 })), receive = vi.fn();
    const offCounts = owner.subscribe("counts", 15000, counts, receive);
    const offInbox = owner.subscribe("inbox:unread", 15000, async () => ({ ok: true, status: 200, data: [] }), () => owner.publish("counts", 4), true);
    await vi.advanceTimersByTimeAsync(15000);
    expect(counts).not.toHaveBeenCalled(); expect(receive).toHaveBeenCalledWith(expect.objectContaining({ data: 4 }));
    offInbox(); await vi.advanceTimersByTimeAsync(0); expect(counts).toHaveBeenCalledTimes(1); offCounts();
  });
  it("retains one queued resume for a busy DM even when another resource cycles first", async () => {
    const owner = new ForegroundUpdates(() => true);
    let resolve!: (value: { ok: true; status: number; data: number }) => void;
    const resumes: boolean[] = [];
    const offDm = owner.subscribe("dm:1", 3000, cycle => {
      resumes.push(cycle.resume);
      return resumes.length === 1 ? new Promise<{ ok: true; status: number; data: number }>(r => { resolve = r; }) : Promise.resolve({ ok: true, status: 200, data: 2 });
    }, () => {});
    const offInbox = owner.subscribe("inbox:all", 15000, async () => ({ ok: true, status: 200, data: 1 }), () => {});
    await vi.advanceTimersByTimeAsync(0);
    owner.foreground(); owner.foreground(); owner.foreground();
    await vi.advanceTimersByTimeAsync(0);
    expect(resumes).toEqual([false]);
    resolve({ ok: true, status: 200, data: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(resumes).toEqual([false, true]);
    offDm(); offInbox();
  });
});
