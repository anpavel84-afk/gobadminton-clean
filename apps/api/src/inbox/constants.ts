export const INBOX_PAGE_DEFAULT = 20;
export const INBOX_PAGE_MAX = 50;

export const DM_REQUEST_SUBTITLE: Record<
  "pending" | "accepted" | "declined" | "expired" | "closed",
  string
> = {
  pending: "Запрос на общение",
  accepted: "Личная переписка",
  declined: "Запрос отклонён",
  expired: "Срок запроса истёк",
  closed: "Общение недоступно",
};

export const INVITATION_SUBTITLE: Record<
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "revoked"
  | "cancelled_by_game",
  string
> = {
  pending: "Ожидает ответа",
  accepted: "Приглашение принято",
  declined: "Приглашение отклонено",
  expired: "Срок приглашения истёк",
  revoked: "Приглашение отозвано",
  cancelled_by_game: "Игра отменена",
};

export const GAME_CHAT_SUBTITLE = "Чат игры";
