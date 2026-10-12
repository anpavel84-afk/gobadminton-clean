import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectHistory } from "../src/lib/direct-history";
import { getContactState, getConversation, listMessages } from "../src/lib/messaging-api";
import type { Conversation, DirectMessage } from "../src/lib/messaging-types";
vi.mock("../src/lib/messaging-api", () => ({ getConversation: vi.fn(), getContactState: vi.fn(), listMessages: vi.fn() }));
const message = (seq: string): DirectMessage => ({ id: seq, seq, conversationId: "dm", authorPublicPlayerId: "peer", kind: "text", createdAt: "2026-10-08T00:00:00Z", contentState: "live", text: seq });
const conversation = { id: "dm", peer: { publicPlayerId: "peer" }, lastMessageSeq: "1" } as Conversation;
const cycle = () => ({ signal: new AbortController().signal, resume: false });
function server(initial = [message("1")]) {
  let items = initial;
  let head = initial.at(-1)?.seq ?? "0";
  vi.mocked(getConversation).mockImplementation(async () => ({ ok: true, status: 200, data: { ...conversation, lastMessageSeq: head } }));
  vi.mocked(getContactState).mockResolvedValue({ ok: true, status: 200, data: { state: "accepted", targetPublicPlayerId: "peer", conversationId: "dm", version: 1 } });
  vi.mocked(listMessages).mockImplementation(async (_id, before, after) => {
    const range = items.filter(m => (!before || BigInt(m.seq) < BigInt(before)) && (!after || BigInt(m.seq) > BigInt(after)));
    const page = after ? range.slice(0, 50) : range.slice(-50);
    return { ok: true, status: 200, data: { items: page, nextCursor: range.length > 50 ? (after ? page.at(-1)!.seq : page[0]!.seq) : null } };
  });
  return (next: DirectMessage[]) => { items = next; if (BigInt(next.at(-1)?.seq ?? "0") > BigInt(head)) head = next.at(-1)!.seq; };
}
afterEach(() => { vi.resetAllMocks(); });
describe("incremental DM history", () => {
  it.each([false, true])("fences delayed older history after a newer authorized snapshot (new message: %s)", async keepNew => {
    const initial = Array.from({ length: 120 }, (_, n) => message(String(n + 1)));
    const update = server(initial), history = new DirectHistory("dm");
    await history.cycle(cycle()); await history.older(cycle().signal);
    let release!: (value: Awaited<ReturnType<typeof listMessages>>) => void;
    vi.mocked(listMessages).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const delayed = history.older(cycle().signal);
    const authorized = keepNew ? [message("121")] : [];
    update(authorized);
    const refreshed = await history.cycle({ ...cycle(), resume: true });
    expect(refreshed.ok && refreshed.data.messages).toEqual(authorized);
    release({ ok: true, status: 200, data: { items: initial.slice(0, 20), nextCursor: null } });
    expect(await delayed).toMatchObject({ ok: false, status: 499 });
    const next = await history.cycle(cycle());
    expect(next.ok && next.data.messages).toEqual(authorized);
  });
  it("accepts only one of overlapping older reads regardless of response order", async () => {
    const initial = Array.from({ length: 120 }, (_, n) => message(String(n + 1)));
    server(initial); const history = new DirectHistory("dm");
    await history.cycle(cycle());
    let release!: (value: Awaited<ReturnType<typeof listMessages>>) => void;
    vi.mocked(listMessages).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const delayed = history.older(cycle().signal);
    const newer = await history.older(cycle().signal);
    expect(newer.ok && newer.data.messages.map(m => m.seq)).toEqual(initial.slice(20).map(m => m.seq));
    release({ ok: true, status: 200, data: { items: initial.slice(20, 70), nextCursor: "21" } });
    expect(await delayed).toMatchObject({ ok: false, status: 499 });
    const final = await history.older(cycle().signal);
    expect(final.ok && final.data.messages).toEqual(initial);
  });
  it("rejects a delayed page after private state is cleared", async () => {
    const initial = Array.from({ length: 120 }, (_, n) => message(String(n + 1)));
    server(initial); const history = new DirectHistory("dm");
    await history.cycle(cycle());
    let release!: (value: Awaited<ReturnType<typeof listMessages>>) => void;
    vi.mocked(listMessages).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const delayed = history.older(cycle().signal);
    history.clear();
    release({ ok: true, status: 200, data: { items: initial.slice(20, 70), nextCursor: "21" } });
    expect(await delayed).toMatchObject({ ok: false, status: 499 });
  });
  it("drains more than 100 committed messages without jumping to the header watermark", async () => {
    const update = server(), history = new DirectHistory("dm");
    await history.cycle(cycle());
    update(Array.from({ length: 252 }, (_, n) => message(String(n + 1))));
    const bounded = await history.cycle(cycle());
    expect(bounded.ok && bounded.data.messages.length).toBe(201); expect(history.catchingUp).toBe(true);
    const completed = await history.cycle(cycle());
    expect(completed.ok && completed.data.messages.map(m => m.seq)).toEqual(Array.from({ length: 252 }, (_, n) => String(n + 1)));
    expect(vi.mocked(listMessages).mock.calls.filter(c => c[2]).map(c => c[2])).toEqual(["1", "51", "101", "151", "201", "251"]);
  });
  it("replaces loaded recent and older authorized ranges after hide/tombstone/purge", async () => {
    const initial = Array.from({ length: 120 }, (_, n) => message(String(n + 1)));
    const update = server(initial), history = new DirectHistory("dm");
    await history.cycle(cycle()); await history.older(cycle().signal); await history.older(cycle().signal);
    update(initial.filter(m => m.seq !== "1" && m.seq !== "5" && m.seq !== "119").map(m => m.seq === "40" ? { ...m, contentState: "purged", text: null } : m));
    let refreshed = await history.cycle({ ...cycle(), resume: true });
    for (let n = 0; n < 4 && history.catchingUp; ++n) refreshed = await history.cycle(cycle());
    expect(refreshed.ok && refreshed.data.messages.some(m => m.seq === "1" || m.seq === "5" || m.seq === "119")).toBe(false);
    expect(refreshed.ok && refreshed.data.messages.find(m => m.seq === "40")?.text).toBeNull();
  });
  it("keeps decimal sequences precise, excludes unauthorized half-success, and rejects aborted completion", async () => {
    const update = server([message("9007199254740993")]), history = new DirectHistory("dm");
    await history.cycle(cycle()); update([message("9007199254740993"), message("9007199254740994")]);
    const next = await history.cycle(cycle());
    expect(next.ok && next.data.messages.map(m => m.seq)).toEqual(["9007199254740993", "9007199254740994"]);
    vi.mocked(getConversation).mockResolvedValueOnce({ ok: false, status: 403, error: "denied" });
    const calls = vi.mocked(listMessages).mock.calls.length;
    expect(await history.cycle(cycle())).toMatchObject({ ok: false, status: 403 }); expect(listMessages).toHaveBeenCalledTimes(calls);
    const controller = new AbortController(); controller.abort();
    expect(await history.cycle({ signal: controller.signal, resume: false })).toMatchObject({ ok: false });
  });
});
