import { describe, expect, it } from "vitest";
import { headerAvatarUrls } from "../src/lib/header-identity";

const uploadedUrl = `/v1/media/avatars/${"a".repeat(64)}.png`;
describe("header image sink bounds", () => {
  it("orders owned upload before an allowed provider", () => {
    expect(headerAvatarUrls({ uploadedUrl, providerUrl: "https://avatars.yandex.net/account/photo" })).toEqual([uploadedUrl, "https://avatars.yandex.net/account/photo"]);
    expect(headerAvatarUrls({ uploadedUrl: null, providerUrl: "https://sun9.userapi.com/photo" })).toEqual(["https://sun9.userapi.com/photo"]);
    expect(headerAvatarUrls()).toEqual([]);
  });
  it.each([
    "http://avatars.yandex.net/photo", "https://avatars.yandex.net.evil.test/photo",
    "https://userapi.com/photo", "https://eviluserapi.com/photo", "https://userapi.com.evil.test/photo",
    "https://evil.test/photo", "https://name:secret@avatars.yandex.net/photo",
    "https://avatars.yandex.net:8443/photo", "//avatars.yandex.net/photo", "data:image/png;base64,AA",
    "https:///@avatars.yandex.net/a", "https:///:@avatars.yandex.net/", "https:////@sun9.userapi.com/a",
    "https://avatars.yandex.net@evil.example/phish",
  ])("denies unknown or credential-bearing provider %s", providerUrl => {
    expect(headerAvatarUrls({ uploadedUrl: null, providerUrl })).toEqual([]);
  });
  it.each(["/v1/media/covers/cover.png", "https://evil.test/photo", "//evil.test/photo", "/v1/media/avatars/../photo.png", `${uploadedUrl}?version=1`])("denies non-owned upload %s", value => {
    expect(headerAvatarUrls({ uploadedUrl: value, providerUrl: null })).toEqual([]);
  });
});
