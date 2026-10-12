import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readSelectedLocation,
  writeSelectedLocation,
} from "../src/lib/location-context";

const KEY = "gb.consumer.location.v1";
const MOSCOW = "a0000000-0000-4000-8000-000000000001";
const PETERSBURG = "a0000000-0000-4000-8000-000000000002";

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

describe("Owner two-city discovery choice", () => {
  it.each([
    [MOSCOW, "Москва"],
    [PETERSBURG, "Санкт-Петербург"],
  ])("retains the canonical city %s", (cityId, nameRu) => {
    session();
    const selected = { cityId, nameRu, timezone: "Europe/Moscow" };
    writeSelectedLocation(selected);
    expect(readSelectedLocation()).toEqual(selected);
  });

  it.each([
    ["1b0685f6-9fcc-571d-b6e4-b82ccc8108f7", "Мытищи"],
    ["a4966885-4c72-5e7f-b1f2-f29ea84d300d", "Всеволожск"],
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
