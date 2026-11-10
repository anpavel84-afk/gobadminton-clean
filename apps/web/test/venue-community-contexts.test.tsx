// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VenueCommunityContent } from "../src/components/consumer/venues/VenueCommunityContent";
import { apiFetch } from "../src/lib/api-client";
vi.mock("../src/lib/api-client", () => ({ apiFetch: vi.fn() }));
vi.mock("../src/components/consumer/venues/VenueCommunityPhotoViewer", () => ({ VenueCommunityPhotoViewer: () => null }));
vi.mock("../src/components/consumer/venues/VenueCommunityRating", () => ({ VenueCommunityRating: () => <section>Оценки</section> }));
vi.mock("../src/components/consumer/venues/VenueReviewsPanel", () => ({ VenueReviewsPanel: () => <section>Отзывы</section> }));
vi.mock("../src/components/consumer/comments/CommentsSection", () => ({
  CommentsSection: ({ onUnresolvedChange }: { onUnresolvedChange: (value: boolean) => void }) => <section>Обсуждение<button onClick={() => onUnresolvedChange(true)}>Незавершённая публикация</button></section>,
}));
const venue = "10000000-0000-4000-8000-000000000001";
afterEach(() => { cleanup(); vi.mocked(apiFetch).mockReset(); });
describe("I2c2 one community owner in page and expanded map host", () => {
  it("keeps one gallery/read across density changes, bottom order and the existing unresolved guard", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, status: 200, data: { venueId: venue, items: [], nextCursor: null } });
    const unresolved = vi.fn();
    const props = { venueId: venue, me: null, authReturnPath: `/venues/${venue}`, onUnresolvedChange: unresolved };
    const { container, rerender } = render(<VenueCommunityContent {...props} />);
    await screen.findByText("Пока нет фотографий сообщества.");
    expect(Array.from(container.querySelectorAll("[data-community-section]")).map((node) => node.getAttribute("data-community-section"))).toEqual(["ratings", "discussion", "reviews", "photos"]);
    expect(container.querySelectorAll("[data-venue-community]")).toHaveLength(1);
    rerender(<VenueCommunityContent {...props} embedded />);
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls).toHaveLength(1));
    expect(screen.getAllByRole("region", { name: "Фотографии сообщества" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Незавершённая публикация" }));
    expect(unresolved).toHaveBeenLastCalledWith(true);
  });
});
