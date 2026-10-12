import { afterEach, expect, it, vi } from "vitest";
import { DirectHistory } from "../src/lib/direct-history";
import { getContactState, getConversation, listMessages } from "../src/lib/messaging-api";
import type { Conversation, DirectMessage } from "../src/lib/messaging-types";
vi.mock("../src/lib/messaging-api", () => ({ getConversation: vi.fn(), getContactState: vi.fn(), listMessages: vi.fn() }));
const conversation = { id: "dm", requestState: "accepted", peer: { publicPlayerId: "peer" }, lastMessageSeq: "1" } as Conversation;
const message = { id: "message", seq: "1", conversationId: "dm", contentState: "live", text: "existing" } as DirectMessage;
function setup(status: number, state: Conversation["requestState"] = "accepted") {
  vi.mocked(getConversation).mockResolvedValue({ ok: true, status: 200, data: { ...conversation, requestState: state } });
  vi.mocked(getContactState).mockResolvedValue({ ok: false, status, error: "unavailable" });
  vi.mocked(listMessages).mockResolvedValue({ ok: true, status: 200, data: { items: [message], nextCursor: null } });
}
const cycle = () => ({ signal: new AbortController().signal, resume: false });
afterEach(() => vi.resetAllMocks());
it("reads accepted authorized legacy history when only contact-state is missing", async () => {
  setup(404);
  expect(await new DirectHistory("dm").cycle(cycle())).toMatchObject({ ok: true, data: { conversation, messages: [message], contactAvailable: true } });
});
it.each(["pending", "declined", "expired", "closed"] as const)("does not manufacture new-contact permission for %s history", async state => {
  setup(404, state);
  expect(await new DirectHistory("dm").cycle(cycle())).toMatchObject({ ok: true, data: { contactAvailable: false } });
});
it.each([401, 403, 409, 429, 500])("does not reinterpret contact %i as missing route", async status => {
  setup(status);
  expect(await new DirectHistory("dm").cycle(cycle())).toMatchObject({ ok: false, status });
  expect(listMessages).not.toHaveBeenCalled();
});
it("keeps history authorization authoritative even after accepted header and contact 404", async () => {
  setup(404); vi.mocked(listMessages).mockResolvedValue({ ok: false, status: 403, error: "denied" });
  expect(await new DirectHistory("dm").cycle(cycle())).toMatchObject({ ok: false, status: 403 });
});
it("ignores old accepted history after its actor generation clears", async () => {
  setup(404); let release!: (value: Awaited<ReturnType<typeof listMessages>>) => void;
  vi.mocked(listMessages).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const history = new DirectHistory("dm"), pending = history.cycle(cycle());
  await vi.waitFor(() => expect(listMessages).toHaveBeenCalled()); history.clear();
  release({ ok: true, status: 200, data: { items: [message], nextCursor: null } });
  expect(await pending).toMatchObject({ ok: false, status: 499 });
});
