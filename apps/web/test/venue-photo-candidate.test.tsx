/** @vitest-environment jsdom */
import { Blob, File } from "node:buffer";
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVenuePhotoCandidate } from "../src/components/consumer/venues/useVenuePhotoCandidate";
import { VenueCandidatePhotoField } from "../src/components/consumer/venues/VenueCandidatePhotoField";
import { preprocessAvatar } from "../src/lib/avatar-preprocess";
import type { CandidateEvidence, VenuePhotoCandidate } from "../src/lib/venue-photo-candidates-api";
import type { ReactNode } from "react";
vi.mock("../src/lib/avatar-preprocess", () => ({ preprocessAvatar: vi.fn(), AVATAR_DERIVATIVE_MAX_BYTES: 512 * 1024 }));
vi.mock("next/link", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
const venue = "10000000-0000-4000-8000-000000000001", id = "10000000-0000-4000-8000-000000000002";
const evidence: CandidateEvidence = { creditKind: "photo", creditText: "Фото: Анна", creditUrl: "https://example.org/anna", sourceUrl: "https://example.org/photo", permissionBasis: "Письменное разрешение автора" };
const receipt = (status: VenuePhotoCandidate["status"] = "awaiting_review"): VenuePhotoCandidate => ({ id, venueId: venue, status, version: status === "awaiting_review" ? 1 : 2, width: 1200, height: 400, evidence, previewPath: status === "awaiting_review" ? `/v1/me/venue-photo-candidates/${id}/content` : null });
const derivative = new Blob(["confirmed-crop"], { type: "image/png" });
const file = new File(["RAW-EXIF"], "source.png", { type: "image/png" });
let upload: () => Promise<Response>;
let withdraw: () => Promise<Response>;
let status: VenuePhotoCandidate;
const json = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code });
function posts() { return vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST"); }
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.mocked(preprocessAvatar).mockReset(); vi.mocked(preprocessAvatar).mockResolvedValue(derivative);
  vi.stubGlobal("URL", class extends URL {
    static override createObjectURL = vi.fn(() => `blob:synthetic-${Math.random()}`);
    static override revokeObjectURL = vi.fn();
  });
  status = receipt(); upload = async () => json(status, 201); withdraw = async () => json(receipt("withdrawn"));
  vi.stubGlobal("fetch", vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") return upload();
    if (init?.method === "DELETE") return withdraw();
    if (String(path).endsWith("/content")) return new Response("private-png", { headers: { "Content-Type": "image/png" } });
    return json(status);
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function prepared(model: ReturnType<typeof renderCandidate>) {
  act(() => model.result.current.select(file));
  await waitFor(() => expect(model.result.current.stage).toBe("prepared"));
  act(() => model.result.current.changeEvidence(evidence));
  act(() => model.result.current.changeRights(true));
  act(() => model.result.current.confirm());
  expect(model.result.current.stage).toBe("confirmed");
}
function renderCandidate() { return renderHook(({ actor, csrf, host }) => useVenuePhotoCandidate(actor, csrf, host, true), { initialProps: { actor: "actor", csrf: "session-a", host: "new" } }); }
describe("I3b optional candidate commands", () => {
  it("invalidates confirmation on evidence/crop edits and uploads only the confirmed derivative after canonical success", async () => {
    const model = renderCandidate(); await prepared(model);
    expect(posts()).toHaveLength(0);
    act(() => model.result.current.changeCrop({ x: .2, y: .5 }));
    expect(model.result.current.canConfirm).toBe(false);
    await waitFor(() => expect(model.result.current.stage).toBe("prepared"));
    expect(preprocessAvatar).toHaveBeenLastCalledWith(file, expect.any(AbortSignal), { x: .2, y: .5 });
    act(() => model.result.current.changeEvidence({ ...evidence, creditText: "Фото: Борис" }));
    expect(model.result.current.canConfirm).toBe(false);
    act(() => model.result.current.submitForVenue(venue)); expect(posts()).toHaveLength(0);
    act(() => model.result.current.changeRights(true)); act(() => model.result.current.confirm());
    status = { ...receipt(), evidence: { ...evidence, creditText: "Фото: Борис" } };
    act(() => model.result.current.send());
    await waitFor(() => expect(model.result.current.receipt?.id).toBe(id));
    expect(posts()).toHaveLength(1); expect(posts()[0]![1]?.body).toBe(derivative);
    expect(posts()[0]![1]?.body).not.toBe(file);
  });
  it("freezes UNKNOWN bytes/evidence/key, blocks editing and duplicate clicks, and only explicitly retries the same packet", async () => {
    upload = async () => json({ ...receipt(), venueId: id }, 201);
    const model = renderCandidate(); await prepared(model);
    act(() => { model.result.current.submitForVenue(venue); model.result.current.submitForVenue(venue); });
    await waitFor(() => expect(model.result.current.stage).toBe("unknown"));
    const first = posts()[0]![1]!;
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    act(() => { model.result.current.changeEvidence({ ...evidence, creditText: "Фото: Другой" }); model.result.current.clear(); });
    expect(model.result.current.evidence.creditText).toBe(evidence.creditText);
    expect(posts()).toHaveLength(1);
    upload = async () => json(receipt(), 201);
    act(() => { model.result.current.retry(); model.result.current.retry(); });
    await waitFor(() => expect(model.result.current.receipt?.id).toBe(id));
    expect(posts()).toHaveLength(2);
    expect(posts()[1]![1]?.body).toBe(first.body);
    expect(new Headers(posts()[1]![1]?.headers).get("Idempotency-Key")).toBe(new Headers(first.headers).get("Idempotency-Key"));
    expect(new Headers(posts()[1]![1]?.headers).get("X-Gallery-Credit-Text")).toBe(new Headers(first.headers).get("X-Gallery-Credit-Text"));
  });
  it("fences a late actor/session completion and aborts requests without automatic auth-restoration upload", async () => {
    let resolve: (response: Response) => void = () => {};
    upload = () => new Promise<Response>(done => { resolve = done; });
    const model = renderCandidate(); await prepared(model);
    act(() => model.result.current.submitForVenue(venue));
    const signal = posts()[0]![1]?.signal;
    model.rerender({ actor: "other", csrf: "session-b", host: "new" });
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolve(json(receipt(), 201)); });
    expect(model.result.current.receipt).toBeNull(); expect(model.result.current.preview).toBeNull();
    expect(posts()).toHaveLength(1);
  });
  it("uses owned status/private preview and a stable withdrawal key/version; accepted media has no withdraw command", async () => {
    const model = renderCandidate(); await prepared(model);
    act(() => model.result.current.submitForVenue(venue));
    await waitFor(() => expect(model.result.current.receipt?.id).toBe(id));
    await waitFor(() => expect(model.result.current.busy).toBe(false));
    expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).endsWith("/content"))).toBe(true);
    withdraw = async () => json({}, 503);
    act(() => model.result.current.withdraw());
    await waitFor(() => expect(model.result.current.stage).toBe("unknown"));
    expect(model.result.current.preview).toBeNull();
    withdraw = async () => json(receipt("withdrawn"));
    act(() => model.result.current.retry());
    await waitFor(() => expect(model.result.current.receipt?.status).toBe("withdrawn"));
    const deletes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(deletes).toHaveLength(2);
    expect(new Headers(deletes[0]![1]?.headers).get("Idempotency-Key")).toBe(new Headers(deletes[1]![1]?.headers).get("Idempotency-Key"));
    expect(new Headers(deletes[0]![1]?.headers).get("X-Photo-Version")).toBe("1");
    expect(JSON.parse(String(deletes[0]![1]?.body))).toEqual({ expectedVersion: 1 });
    model.unmount();
    const acceptedModel = renderCandidate(); await prepared(acceptedModel);
    act(() => acceptedModel.result.current.submitForVenue(venue));
    await waitFor(() => expect(acceptedModel.result.current.receipt?.id).toBe(id));
    await waitFor(() => expect(acceptedModel.result.current.busy).toBe(false));
    status = receipt("accepted"); act(() => acceptedModel.result.current.refresh());
    await waitFor(() => expect(acceptedModel.result.current.receipt?.status).toBe("accepted"));
    act(() => acceptedModel.result.current.withdraw());
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(2);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
  it("shows optional truthful limits and requires real evidence/rights in the existing field", async () => {
    function Field() { const model = useVenuePhotoCandidate("actor", "csrf", "host", true); return <VenueCandidatePhotoField model={model} />; }
    render(<Field />);
    expect(screen.getByText(/до 10 МиБ и 50 Мп/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Выбрать фото площадки"), { target: { files: [file] } });
    await screen.findByAltText("Подготовленный фрагмент фото площадки");
    expect(screen.getByRole("button", { name: "Подтвердить фото площадки и права" }).hasAttribute("disabled")).toBe(true);
    expect(posts()).toHaveLength(0);
  });
});
