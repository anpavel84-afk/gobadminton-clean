import { describe, expect, it } from "vitest";
import { safeProviderAvatar } from "../../src/profiles/avatar-presentation";
import {
  projectCommentAvatar,
  projectConversationRequestAvatar,
  projectOwnAvatarReceipt,
  projectPublicAvatar,
} from "../../src/profiles/public-avatar-projection";

describe("D1 public provider-avatar quarantine", () => {
  it("keeps OAuth ingest sanitizer usable while public projection always nulls providerUrl", () => {
    expect(safeProviderAvatar("https://avatars.yandex.net/test")).toBe(
      "https://avatars.yandex.net/test",
    );
    expect(safeProviderAvatar("https://sun9.userapi.com/photo")).toBe(
      "https://sun9.userapi.com/photo",
    );
    expect(
      projectPublicAvatar({
        uploadedUrl: "/v1/media/avatars/" + "a".repeat(64) + ".png",
        providerUrl: "https://avatars.yandex.net/test",
      }),
    ).toEqual({
      uploadedUrl: "/v1/media/avatars/" + "a".repeat(64) + ".png",
      providerUrl: null,
    });
    expect(
      projectPublicAvatar({ uploadedUrl: null, providerUrl: "https://sun9.userapi.com/x" }),
    ).toEqual({ uploadedUrl: null, providerUrl: null });
  });

  it("quarantines legacy receipt bodies at DTO boundaries without altering IDs/status fields", () => {
    const avatarReceipt = projectOwnAvatarReceipt({
      version: 3,
      avatar: {
        uploadedUrl: "/v1/media/avatars/" + "b".repeat(64) + ".png",
        providerUrl: "https://avatars.yandex.net/legacy",
      },
    });
    expect(avatarReceipt).toEqual({
      version: 3,
      avatar: {
        uploadedUrl: "/v1/media/avatars/" + "b".repeat(64) + ".png",
        providerUrl: null,
      },
    });

    const comment = projectCommentAvatar({
      id: "c1",
      version: 2,
      author: {
        publicPlayerId: "p1",
        displayName: "Игрок",
        avatar: { uploadedUrl: null, providerUrl: "https://sun1.userapi.com/old" },
        profilePublic: true,
      },
    });
    expect(comment.id).toBe("c1");
    expect(comment.version).toBe(2);
    expect(comment.author.avatar).toEqual({ uploadedUrl: null, providerUrl: null });

    const dm = projectConversationRequestAvatar({
      conversation: {
        id: "conv",
        version: 1,
        peer: {
          publicPlayerId: "peer",
          displayName: "Игрок",
          avatar: { uploadedUrl: null, providerUrl: "https://avatars.yandex.net/peer" },
        },
      },
      receipt: { messageId: "m1", outcome: "created" },
    });
    expect(dm.conversation.id).toBe("conv");
    expect(dm.receipt).toEqual({ messageId: "m1", outcome: "created" });
    expect(dm.conversation.peer.avatar.providerUrl).toBeNull();
  });
});
