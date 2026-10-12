import type { ApiResult } from "./api-client";
import { getContactState, getConversation, listMessages } from "./messaging-api";
import { mergeMessages } from "./messaging-presentation";
import type { Conversation, DirectMessage } from "./messaging-types";

export type DirectSnapshot = { conversation: Conversation; messages: DirectMessage[]; cursor: string | null; contactAvailable: boolean };
/** State is private to one subscribed actor/thread generation; timeout cannot commit it. */
export class DirectHistory {
  private snapshot?: DirectSnapshot;
  private reconcileBefore?: string;
  private reconciledAt = 0;
  private watermark = "0";
  private revision = 0;
  private deltaPending = false;
  constructor(private id: string) {}

  clear() { ++this.revision; this.snapshot = undefined; this.watermark = "0"; this.reconcileBefore = undefined; this.reconciledAt = 0; this.deltaPending = false; }

  async cycle({ signal, resume }: { signal: AbortSignal; resume: boolean }): Promise<ApiResult<DirectSnapshot>> {
    const revision = this.revision;
    const header = await getConversation(this.id, signal);
    if (!header.ok) return header;
    const contact = await getContactState(header.data.peer.publicPlayerId, signal);
    // Only the missing read route may fall back to an already authorized thread.
    // Pending/terminal history never supplies consent or permission to accept it.
    if (!contact.ok && contact.status !== 404) return contact;
    const contactAvailable = contact.ok
      ? contact.data.targetPublicPlayerId === header.data.peer.publicPlayerId && ["accepted", "pending_incoming", "pending_outgoing"].includes(contact.data.state)
      : header.data.requestState === "accepted";
    let messages = this.snapshot?.messages ?? [], cursor = this.snapshot?.cursor ?? null;
    let watermark = this.watermark, before = this.reconcileBefore, reconciledAt = this.reconciledAt;
    let pages = 0, deltaPending = false;
    if (!this.snapshot || watermark === "0") {
      const page = await listMessages(this.id, undefined, undefined, signal);
      if (!page.ok) return page;
      messages = page.data.items; cursor = page.data.nextCursor; watermark = messages.at(-1)?.seq ?? "0"; ++pages;
    } else {
      while (pages < 4) {
        const page = await listMessages(this.id, undefined, watermark, signal);
        if (!page.ok) return page;
        ++pages;
        messages = mergeMessages(messages, page.data.items);
        if (!page.data.items.length) break;
        watermark = page.data.items.at(-1)!.seq;
        deltaPending = !!page.data.nextCursor;
        if (!deltaPending) break;
      }
    }
    if (resume || (!before && Date.now() - this.reconciledAt >= 30000)) before = String(BigInt(header.data.lastMessageSeq) + 1n);
    const floor = messages[0]?.seq ?? "1";
    while (before && pages < 4) {
      const page = await listMessages(this.id, before, undefined, signal);
      if (!page.ok) return page;
      ++pages;
      const low = page.data.nextCursor ? page.data.items[0]?.seq ?? floor : floor;
      // Replace the authorized range, so hidden/purged rows cannot survive a merge cache.
      messages = mergeMessages(messages.filter(m => BigInt(m.seq) < BigInt(low) || BigInt(m.seq) >= BigInt(before!)), page.data.items.filter(m => BigInt(m.seq) >= BigInt(floor)));
      before = BigInt(low) <= BigInt(floor) || !page.data.nextCursor ? undefined : page.data.nextCursor;
      if (!before) reconciledAt = Date.now();
    }
    if (signal.aborted || revision !== this.revision) return { ok: false, status: signal.aborted ? 0 : 499, error: "Обновление отменено" };
    // Every authorized snapshot, including empty history, supersedes pending pages.
    // A page fetched before this publication must not restore now-hidden rows.
    ++this.revision;
    this.reconciledAt = reconciledAt; this.deltaPending = deltaPending; this.watermark = watermark; this.reconcileBefore = before;
    this.snapshot = { conversation: header.data, messages, cursor, contactAvailable };
    return { ok: true, status: 200, data: this.snapshot };
  }
  async older(signal: AbortSignal): Promise<ApiResult<DirectSnapshot>> {
    const snapshot = this.snapshot, revision = this.revision;
    if (!snapshot?.cursor) return { ok: false, status: 0, error: "История недоступна" };
    const page = await listMessages(this.id, snapshot.cursor, undefined, signal);
    if (!page.ok) return page;
    if (signal.aborted || revision !== this.revision) return { ok: false, status: signal.aborted ? 0 : 499, error: "Обновление отменено" };
    ++this.revision;
    this.snapshot = { ...this.snapshot!, messages: mergeMessages(this.snapshot!.messages, page.data.items), cursor: page.data.nextCursor };
    return { ok: true, status: 200, data: this.snapshot };
  }
  get catchingUp() { return this.deltaPending || !!this.reconcileBefore; }
}
