// @vitest-environment jsdom
import { File } from "node:buffer";
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Me } from "../src/lib/consumer-types";
import type { EntityComment } from "../src/lib/comments-types";
import { CommentsSection } from "../src/components/consumer/comments/CommentsSection";
import { apiFetch } from "../src/lib/api-client";

vi.mock("../src/lib/api-client", () => ({ apiFetch: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../src/components/consumer/players/ProfileComposition", () => ({
  Avatar: () => <span>Аватар</span>, AuthChooser: () => null,
  ProfileDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../src/components/consumer/messages/ConversationSafety", () => ({ ConversationSafety: () => null }));
vi.mock("../src/components/consumer/venues/VenueCommunityReportDialog", () => ({ VenueCommunityReportDialog: () => null }));
const venue = "10000000-0000-4000-8000-000000000001";
const commentId = "10000000-0000-4000-8000-000000000002";
const photoId = "10000000-0000-4000-8000-000000000003";
const otherPhoto = "10000000-0000-4000-8000-000000000004";
const me = { id: "actor-a", csrfToken: "synthetic-csrf", displayName: "Автор" } as Me;
const photo = (id = photoId, version = 1) => ({ id, width: 400, height: 300, url: `/v1/comments/${commentId}/revisions/${version}/photos/${id}` });
const receipt = (id = photoId) => ({ id, venueId: venue, status: "ready", version: 1, expiresAt: new Date(Date.now() + 3600000).toISOString(), width: 400, height: 300, previewPath: `/v1/me/venue-photo-submissions/${id}/content` });
function source(body: string | null, photos = [] as ReturnType<typeof photo>[]): EntityComment {
  return { id: commentId, entityKind: "venue", entityId: venue, parentCommentId: null,
    body, photos, deleted: false, version: 1, createdAt: "2026-11-10T10:00:00Z", updatedAt: "2026-11-10T10:00:00Z", edited: false, mine: true, author: null, replyCount: 0 };
}
let items: EntityComment[];
let failEdit: boolean;
let upload: () => Promise<unknown>;
let presentation: (text: string) => string;
const ok = (data: unknown, status = 200) => ({ ok: true, status, data });
const props = { kind: "venue" as const, entityId: venue, me, parentPublic: true, description: "Обсуждение", authReturnPath: `/venues/${venue}` };
function commands() { return vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method && init.method !== "GET"); }
function publications() { return commands().filter(([path]) => path.endsWith("/comments")); }
function file(bytes = "synthetic-image") { return new File([bytes], "photo.png", { type: "image/png" }); }
async function selectPhoto(inputFile = file()) {
  const checkbox = screen.getAllByRole("checkbox").at(-1)!;
  if (!(checkbox as HTMLInputElement).checked) fireEvent.click(checkbox);
  const inputs = screen.getAllByLabelText("Добавить фото / выбрать прежний файл для повтора");
  fireEvent.change(inputs.at(-1)!, { target: { files: [inputFile] } });
  await waitFor(() => expect(commands().some(([path]) => path.endsWith("comment-photos"))).toBe(true));
}
async function edit() {
  fireEvent.click(screen.getByRole("button", { name: "Действия с комментарием" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Изменить" }));
  return screen.getByLabelText("Редактирование");
}
beforeEach(() => {
  sessionStorage.clear(); items = []; failEdit = false;
  presentation = (s) => s; upload = async () => ok(receipt(), 201);
  vi.stubGlobal("crypto", webcrypto);
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation(async (path, init) => {
    if (path.endsWith("/comment-photos")) return await upload() as never;
    if (path.includes("/venue-photo-submissions/")) {
      if (init?.method === "DELETE") return ok({ ...receipt(), status: "withdrawn", version: 2, previewPath: null }) as never;
      return ok(receipt()) as never;
    }
    if (!init?.method) return ok({ entityKind: props.kind, entityId: props.entityId, parentCommentId: null, items, nextCursor: null, visibleCount: items.length, canCreate: true }) as never;
    const body = JSON.parse(init.body as string);
    if (init.method === "PUT" && failEdit) return { ok: false, status: 422, error: "rejected", problem: { code: "PUBLIC_TEXT_CONTENT_REJECTED" } } as never;
    const version = init.method === "PUT" ? body.expectedVersion + 1 : 1;
    const data = { ...source(body.text?.trim() ? presentation(body.text) : null, (body.photoIds ?? []).map((id: string) => photo(id, version))), version, parentCommentId: body.parentCommentId ?? null };
    items = [data]; return ok(data, init.method === "POST" ? 201 : 200) as never;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("I2c1 mounted venue contribution", () => {
  it.each(["", "Текст с фото"])("publishes an atomic ordered photo set with text %j", async (text) => {
    const unresolved = vi.fn(); render(<CommentsSection {...props} onUnresolvedChange={unresolved} />);
    await screen.findByLabelText("Ваш комментарий");
    expect(screen.getByRole("button", { name: "Отправить" }).hasAttribute("disabled")).toBe(true);
    await selectPhoto(); await screen.findByAltText("Выбранное фото 1");
    if (text) fireEvent.change(screen.getByLabelText("Ваш комментарий"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await screen.findByText("Комментарий сохранён.");
    expect(JSON.parse(publications()[0]![1]!.body as string)).toEqual({ text, parentCommentId: null, photoIds: [photoId] });
    await screen.findByAltText("Фото 1 к комментарию");
    expect(items[0]!.body).toBe(text || null);
    expect(commands().filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
    await waitFor(() => expect(unresolved).toHaveBeenLastCalledWith(false));
  });

  it("holds malformed/UNKNOWN uploads and retries the same key/bytes/rights", async () => {
    upload = async () => ok({ ...receipt(), venueId: "foreign" }, 201);
    render(<CommentsSection {...props} />); await screen.findByLabelText("Ваш комментарий");
    const image = file(); await selectPhoto(image);
    await screen.findByText(/Ответ не подтверждён/);
    fireEvent.change(screen.getByLabelText("Ваш комментарий"), { target: { value: "Есть текст" } });
    expect(screen.getByRole("button", { name: "Отправить" }).hasAttribute("disabled")).toBe(true);
    const first = commands()[0]![1]!;
    upload = async () => ok(receipt(), 201);
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await screen.findByAltText("Выбранное фото 1");
    const second = commands()[1]![1]!;
    expect(second.body).toBe(first.body); expect(second.headers).toEqual(first.headers);
    expect((second.headers as Record<string, string>)["X-Photo-Rights"]).toBe("community-photo-rights-v1");
    expect(publications()).toHaveLength(0);
  });

  it("keeps old accepted content on failed edit and removes retained photos only through PUT", async () => {
    items = [source("Старый текст", [photo()])]; failEdit = true;
    render(<CommentsSection {...props} />); await screen.findByText("Старый текст");
    const input = await edit();
    fireEvent.change(input, { target: { value: "Новый текст" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByText("Измените текст комментария");
    await screen.findByText("Старый текст");
    expect(items[0]!.photos?.map((p) => p.id)).toEqual([photoId]);
    fireEvent.click(screen.getByRole("button", { name: "Убрать фото 1" }));
    failEdit = false; fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByText("Комментарий сохранён.");
    const puts = commands().filter(([, init]) => init?.method === "PUT");
    expect(JSON.parse(puts[0]![1]!.body as string).photoIds).toEqual([photoId]);
    expect(JSON.parse(puts[1]![1]!.body as string).photoIds).toEqual([]);
    expect(commands().some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("orders retained current IDs without another private preflight", async () => {
    items = [source("Текст", [photo(), photo(otherPhoto)])];
    render(<CommentsSection {...props} />); await screen.findByText("Текст"); await edit();
    fireEvent.click(screen.getByRole("button", { name: "Фото 2 раньше" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByText("Комментарий сохранён.");
    expect(JSON.parse(commands()[0]![1]!.body as string).photoIds).toEqual([otherPhoto, photoId]);
  });

  it.each(["ready", "unknown"])("restores published photos on cancel/reopen with a %s stage and saves the explicit order", async (state) => {
    items = [source("Старый текст", [photo()])];
    upload = async () => state === "ready" ? ok(receipt(otherPhoto), 201) : { ok: false, status: 0, error: "packet lost" };
    const unresolved = vi.fn();
    render(<CommentsSection {...props} onUnresolvedChange={unresolved} />);
    await screen.findByText("Старый текст"); await edit();
    fireEvent.change(screen.getByLabelText("Редактирование"), { target: { value: "Отменённый текст" } });
    await selectPhoto();
    if (state === "ready") await screen.findByAltText("Выбранное фото 2");
    else await screen.findByText("Результат пока неизвестен. Повтор использует ту же попытку.");
    const stagedRecord = sessionStorage.getItem(`gb-venue-comment-photos:${me.id}:${venue}`);
    const originalUpload = commands()[0]![1]!;
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(items[0]!.photos?.map((p) => p.id)).toEqual([photoId]);
    expect(sessionStorage.getItem(`gb-venue-comment-photos:${me.id}:${venue}`)).toBe(stagedRecord);
    expect(commands()).toHaveLength(1);
    await waitFor(() => expect(unresolved).toHaveBeenLastCalledWith(true));
    expect((await edit() as HTMLTextAreaElement).value).toBe("Старый текст");
    await screen.findByAltText("Выбранное фото 1");
    expect(sessionStorage.getItem(`gb-venue-comment-photos:${me.id}:${venue}`)).toBe(stagedRecord);
    if (state === "unknown") {
      expect(screen.getByRole("button", { name: "Сохранить" }).hasAttribute("disabled")).toBe(true);
      upload = async () => ok(receipt(otherPhoto), 201);
      fireEvent.click(screen.getAllByRole("checkbox").at(-1)!);
      fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
      await screen.findByAltText("Выбранное фото 2");
      expect(commands()[1]![1]!.headers).toEqual(originalUpload.headers);
      expect(commands()[1]![1]!.body).toBe(originalUpload.body);
    }
    fireEvent.click(screen.getByRole("button", { name: "Фото 2 раньше" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByText("Комментарий сохранён.");
    const put = commands().find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(put[1]!.body as string)).toEqual({ text: "Старый текст", expectedVersion: 1, photoIds: [otherPhoto, photoId] });
    expect(items[0]!.version).toBe(2);
    expect(items[0]!.photos?.map((p) => p.id)).toEqual([otherPhoto, photoId]);
    expect(commands().some(([, init]) => init?.method === "DELETE")).toBe(false);
    await waitFor(() => expect(unresolved).toHaveBeenLastCalledWith(false));
  });

  it("requires explicit removal when restoring published photos plus a cancelled replacement exceeds four", async () => {
    const third = "10000000-0000-4000-8000-000000000005";
    const fourth = "10000000-0000-4000-8000-000000000006";
    const staged = "10000000-0000-4000-8000-000000000007";
    items = [source("Текст", [photo(), photo(otherPhoto), photo(third), photo(fourth)])];
    upload = async () => ok(receipt(staged), 201);
    render(<CommentsSection {...props} />); await screen.findByText("Текст"); await edit();
    fireEvent.click(screen.getByRole("button", { name: "Убрать фото 1" }));
    await selectPhoto(); await screen.findByAltText("Выбранное фото 4");
    fireEvent.click(screen.getByRole("button", { name: "Отмена" })); await edit();
    expect(screen.getAllByAltText(/Выбранное фото/)).toHaveLength(5);
    await within(screen.getByLabelText("Редактирование").closest("form")!).findByText("Не больше четырёх фото в публикации. Уберите лишние фото перед сохранением.");
    expect(screen.getByRole("button", { name: "Сохранить" }).hasAttribute("disabled")).toBe(true);
    expect(commands()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Убрать фото 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByText("Комментарий сохранён.");
    expect(JSON.parse(commands()[1]![1]!.body as string)).toEqual({ text: "Текст", expectedVersion: 1, photoIds: [photoId, third, fourth, staged] });
    expect(commands().some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("preserves a staged withdrawal and its frozen key across cancel/reopen", async () => {
    items = [source("Текст", [photo()])]; upload = async () => ok(receipt(otherPhoto), 201);
    const implementation = vi.mocked(apiFetch).getMockImplementation()!;
    vi.mocked(apiFetch).mockImplementation(async (path, init) => init?.method === "DELETE"
      ? { ok: false, status: 0, error: "packet lost" } as never : implementation(path, init));
    const unresolved = vi.fn();
    render(<CommentsSection {...props} onUnresolvedChange={unresolved} />);
    await screen.findByText("Текст"); await edit(); await selectPhoto(); await screen.findByAltText("Выбранное фото 2");
    fireEvent.click(screen.getByRole("button", { name: "Убрать фото 2" }));
    await screen.findByText("Результат пока неизвестен. Повтор использует ту же попытку.");
    const record = sessionStorage.getItem(`gb-venue-comment-photos:${me.id}:${venue}`);
    fireEvent.click(screen.getByRole("button", { name: "Отмена" })); await edit();
    await screen.findByAltText("Выбранное фото 1");
    expect(sessionStorage.getItem(`gb-venue-comment-photos:${me.id}:${venue}`)).toBe(record);
    expect(commands()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(commands()).toHaveLength(3));
    await screen.findByText("Результат пока неизвестен. Повтор использует ту же попытку.");
    expect(commands()[2]![1]).toEqual(expect.objectContaining({ headers: commands()[1]![1]!.headers, body: commands()[1]![1]!.body }));
    expect(commands()[1]![0]).toContain(otherPhoto);
    expect(commands()[2]![0]).toBe(commands()[1]![0]);
    expect(sessionStorage.getItem(`gb-venue-comment-photos:${me.id}:${venue}`)).toBe(record);
    expect(publications()).toHaveLength(0);
    await waitFor(() => expect(unresolved).toHaveBeenLastCalledWith(true));
  });

  it.each(["actor", "session", "entity"])("hides private/late results across %s boundary", async (boundary) => {
    let finish!: (value: unknown) => void; upload = () => new Promise((resolve) => { finish = resolve; });
    const view = render(<CommentsSection {...props} />); await screen.findByLabelText("Ваш комментарий"); await selectPhoto();
    const oldRecord = sessionStorage.getItem(`gb-venue-comment-photos:${me.id}:${venue}`);
    if (boundary === "session") act(() => { window.dispatchEvent(new Event("gb-private-expired")); });
    else view.rerender(<CommentsSection {...props} {...(boundary === "actor" ? { me: { ...me, id: "actor-b" } } : { entityId: "10000000-0000-4000-8000-000000000009" })} />);
    await act(async () => { finish(ok(receipt(), 201)); });
    expect(screen.queryByAltText("Выбранное фото 1")).toBeNull();
    expect(sessionStorage.getItem(`gb-venue-comment-photos:${me.id}:${venue}`)).toBe(oldRecord);
    expect(publications()).toHaveLength(0);
  });

  it("ignores a late file hash even after returning to the original actor/session", async () => {
    let finish!: (bytes: ArrayBuffer) => void;
    const hashing = vi.spyOn(webcrypto.subtle, "digest").mockImplementationOnce(() => new Promise<ArrayBuffer>((resolve) => { finish = resolve; }));
    try {
      const view = render(<CommentsSection {...props} />); await screen.findByLabelText("Ваш комментарий");
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.change(screen.getByLabelText("Добавить фото / выбрать прежний файл для повтора"), { target: { files: [file()] } });
      await waitFor(() => expect(hashing).toHaveBeenCalledTimes(1));
      view.rerender(<CommentsSection {...props} me={{ ...me, id: "actor-b" }} />);
      view.rerender(<CommentsSection {...props} />);
      await screen.findByLabelText("Ваш комментарий");
      await act(async () => { finish(new Uint8Array(32).buffer); });
      expect(commands()).toHaveLength(0);
      expect(sessionStorage.getItem(`gb-venue-comment-photos:${me.id}:${venue}`)).toBeNull();
      expect(screen.queryByAltText("Выбранное фото 1")).toBeNull();
    } finally { hashing.mockRestore(); }
  });

  it.each([["хуйня", "*****"], ["ⓗⓤⓨ", "***"]])("settles server presentation of %s but holds unrelated text without replay", async (input, masked) => {
    presentation = () => masked;
    const first = render(<CommentsSection {...props} />); await screen.findByLabelText("Ваш комментарий");
    fireEvent.change(screen.getByLabelText("Ваш комментарий"), { target: { value: input } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" })); await screen.findByText("Комментарий сохранён.");
    expect(sessionStorage.getItem(`gb-fr04-pending:comments:venue:${venue}:${me.id}`)).toBeNull();
    first.unmount(); items = []; presentation = () => input === "хуйня" ? "друго" : "xyz";
    render(<CommentsSection {...props} />); await screen.findByLabelText("Ваш комментарий");
    fireEvent.change(screen.getByLabelText("Ваш комментарий"), { target: { value: input } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await screen.findByText("Результат не подтверждён. Не повторяйте отправку.");
    expect(sessionStorage.getItem(`gb-fr04-pending:comments:venue:${venue}:${me.id}`)).not.toBeNull();
    expect(publications()).toHaveLength(2);
  });

  it("starts at most two uploads and settles a reordered initial user-selected queue", async () => {
    const finishes: Array<(result: unknown) => void> = [];
    upload = () => new Promise((resolve) => { finishes.push(resolve); });
    const unresolved = vi.fn();
    render(<CommentsSection {...props} onUnresolvedChange={unresolved} />); await screen.findByLabelText("Ваш комментарий");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Добавить фото / выбрать прежний файл для повтора"), {
      target: { files: [file("one"), file("two"), file("three"), file("four")] },
    });
    await waitFor(() => expect(screen.getAllByText(/Проверяется/)).toHaveLength(4));
    expect(finishes).toHaveLength(2);
    const thirdId = "10000000-0000-4000-8000-000000000005";
    const fourthId = "10000000-0000-4000-8000-000000000006";
    await act(async () => { finishes[0]!(ok(receipt(photoId), 201)); });
    await waitFor(() => expect(finishes).toHaveLength(3));
    await act(async () => { finishes[1]!(ok(receipt(otherPhoto), 201)); });
    await waitFor(() => expect(finishes).toHaveLength(4));
    await act(async () => { finishes[2]!(ok(receipt(thirdId), 201)); finishes[3]!(ok(receipt(fourthId), 201)); });
    await waitFor(() => expect(screen.getAllByAltText(/Выбранное фото/)).toHaveLength(4));
    expect(commands()).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Фото 2 раньше" }));
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await screen.findByText("Комментарий сохранён.");
    expect(JSON.parse(publications()[0]![1]!.body as string).photoIds).toEqual([otherPhoto, photoId, thirdId, fourthId]);
    await waitFor(() => expect(unresolved).toHaveBeenLastCalledWith(false));
  });

  it("requires explicit removal of a rejected selection before publishing text", async () => {
    upload = async () => ({ ok: false, status: 422, error: "rejected" });
    render(<CommentsSection {...props} />); await screen.findByLabelText("Ваш комментарий");
    await selectPhoto(); await screen.findByText("Фото отклонено. Удалите его из публикации.");
    fireEvent.change(screen.getByLabelText("Ваш комментарий"), { target: { value: "Только текст" } });
    expect(screen.getByRole("button", { name: "Отправить" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Убрать фото 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await screen.findByText("Комментарий сохранён.");
    expect(JSON.parse(publications()[0]![1]!.body as string).photoIds).toEqual([]);
  });

  it("recovers UNKNOWN after reload only with an exact reselected file and the frozen key", async () => {
    upload = async () => ({ ok: false, status: 0, error: "packet lost" });
    const first = render(<CommentsSection {...props} />); await screen.findByLabelText("Ваш комментарий");
    const image = file(); await selectPhoto(image); await screen.findByText("Результат пока неизвестен. Повтор использует ту же попытку.");
    const original = commands()[0]![1]!; first.unmount();
    render(<CommentsSection {...props} />); await screen.findByLabelText("Ваш комментарий");
    expect(commands()).toHaveLength(1); // No automatic request after restoration.
    await selectPhoto(file("different bytes"));
    await screen.findByText(/Файл не совпадает/); expect(commands()).toHaveLength(1);
    await selectPhoto(image); await screen.findByText(/Файл совпадает/);
    upload = async () => ok(receipt(), 201);
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await screen.findByAltText("Выбранное фото 1");
    expect(commands()[1]![1]!.headers).toEqual(original.headers);
    const record = sessionStorage.getItem(`gb-venue-comment-photos:${me.id}:${venue}`)!;
    expect(record).not.toContain("synthetic-csrf"); expect(record).not.toContain("synthetic-image");
    expect(record).not.toContain("base64");
  });

  it("uses the existing reply mutation for photo-only replies", async () => {
    items = [source("Корневой комментарий")];
    render(<CommentsSection {...props} />); await screen.findByText("Корневой комментарий");
    fireEvent.click(screen.getByRole("button", { name: "Ответить" }));
    await selectPhoto(); await screen.findByAltText("Выбранное фото 1");
    fireEvent.click(screen.getAllByRole("button", { name: "Ответить" }).at(-1)!);
    await screen.findByText("Комментарий сохранён.");
    expect(JSON.parse(publications()[0]![1]!.body as string)).toEqual({ text: "", photoIds: [photoId], parentCommentId: commentId });
  });

  it("shows an honest unavailable message when current public media fails", async () => {
    items = [source(null, [photo()])]; render(<CommentsSection {...props} />);
    const image = await screen.findByAltText("Фото 1 к комментарию"); fireEvent.error(image);
    await screen.findByText(/Фото 1 недоступно/);
    expect(screen.queryByAltText("Фото 1 к комментарию")).toBeNull();
    expect(screen.getByRole("button", { name: "Обновить комментарии" })).toBeTruthy();
  });

  it("keeps game comments text required without a photo input", async () => {
    vi.mocked(apiFetch).mockResolvedValue(ok({ entityKind: "game", entityId: venue, items: [], nextCursor: null, visibleCount: 0, canCreate: true, parentCommentId: null }) as never);
    render(<CommentsSection {...props} kind="game" />); await screen.findByLabelText("Ваш комментарий");
    expect(screen.queryByRole("checkbox")).toBeNull(); expect(screen.getByRole("button", { name: "Отправить" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("I2c2 same-host source target", () => {
  it("focuses an authorized later-page reply without scanning root/reply pages or duplicating it", async () => {
    items = [];
    const target = { ...source("Ответ с другой страницы", [photo()]), parentCommentId: otherPhoto };
    render(<CommentsSection {...props} sourceComment={target} onOpenPhoto={vi.fn()} />);
    await screen.findByText("Пока нет комментариев. Начните разговор.");
    const article = screen.getByRole("article", { name: "Исходная публикация" });
    expect(article.textContent).toContain("Ответ в обсуждении площадки");
    expect(screen.getAllByText("Ответ с другой страницы")).toHaveLength(1);
    expect(document.activeElement).toBe(article);
    expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path.includes("/comments"))).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Открыть фото 1 к комментарию" })).toBeTruthy();
  });
  it("focuses the existing exact-version article when its source is already mounted", async () => {
    const target = source("Уже загруженная публикация", [photo()]); items = [target];
    render(<CommentsSection {...props} sourceComment={target} />);
    await waitFor(() => expect(screen.queryByRole("article", { name: "Исходная публикация" })).toBeNull());
    const article = document.querySelector(`[data-comment-id="${commentId}"]`);
    expect(article).toBeTruthy(); expect(document.activeElement).toBe(article);
    expect(screen.getAllByText("Уже загруженная публикация")).toHaveLength(1);
  });
});
