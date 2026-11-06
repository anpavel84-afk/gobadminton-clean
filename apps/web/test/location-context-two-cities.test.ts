import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readSelectedLocation,
  writeSelectedLocation,
} from "../src/lib/location-context";

const KEY = "gb.consumer.location.v1";
const MOSCOW = "a0000000-0000-4000-8000-000000000001";
const PETERSBURG = "a0000000-0000-4000-8000-000000000002";
const NOVOSIBIRSK = "1775016f-373e-5a15-958b-1305770b2b16";
const KAZAN = "5c219eb1-87da-5fd3-9194-20e9d1501315";

function session() {
  const store = new Map<string, string>();
  const api = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
  vi.stubGlobal("window", { sessionStorage: api });
  return api;
}

afterEach(() => vi.unstubAllGlobals());

describe("Owner discovery city choice including regional cities", () => {
  it.each([
    [MOSCOW, "Москва", "Europe/Moscow"],
    [PETERSBURG, "Санкт-Петербург", "Europe/Moscow"],
    [NOVOSIBIRSK, "Новосибирск", "Asia/Novosibirsk"],
    [KAZAN, "Казань", "Europe/Moscow"],
  ])("retains the canonical city %s", (cityId, nameRu, timezone) => {
    session();
    writeSelectedLocation({ cityId, nameRu: "spoofed", timezone: "Invalid/Zone" });
    expect(readSelectedLocation()).toEqual({ cityId, nameRu, timezone });
  });

  it.each([
    ["1b0685f6-9fcc-571d-b6e4-b82ccc8108f7", "Мытищи"],
    ["a4966885-4c72-5e7f-b1f2-f29ea84d300d", "Всеволожск"],
    ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Челябинск"],
  ])("clears stale imported municipality %s from existing sessions", (cityId, nameRu) => {
    const storage = session();
    storage.setItem(KEY, JSON.stringify({ cityId, nameRu, timezone: "Europe/Moscow" }));
    expect(readSelectedLocation()).toBeNull();
    expect(storage.getItem(KEY)).toBeNull();
  });

  it("does not invent a city when the client selection is absent", () => {
    session();
    expect(readSelectedLocation()).toBeNull();
  });
});
