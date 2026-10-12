/**
 * Deterministic social backfill for the same 20 foundation demo identities.
 * Consumed only by `--mode full`. Never invents Radar live presence.
 */
import {
  demoDmConversationId,
  demoGameConversationId,
  demoGameId,
  demoGameInvitationId,
  demoMessageId,
  demoParticipationId,
  demoSocialPairId,
  demoUserId,
} from "./demo-ids";

export type DemoDmRequestState =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "closed";

export type DemoSeedMessage = {
  id: string;
  authorOrdinal: number;
  bodyText: string;
  /** Hours before "now" for created_at (positive = past). */
  createdHoursAgo: number;
};

export type DemoDmThread = {
  id: string;
  pairId: string;
  initiatorOrdinal: number;
  recipientOrdinal: number;
  requestState: DemoDmRequestState;
  /** Hours from now; required when requestState is pending (may be negative = expired). */
  requestExpiresHoursFromNow: number | null;
  messages: DemoSeedMessage[];
  initiatorReadThrough: number;
  recipientReadThrough: number;
};

export type DemoInvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "revoked"
  | "cancelled_by_game";

export type DemoInvitationSeed = {
  id: string;
  pairId: string;
  gameOrdinal: number;
  inviterOrdinal: number;
  inviteeOrdinal: number;
  status: DemoInvitationStatus;
  /** Hours from now; required for pending (may be negative for stored-pending+expired projection). */
  expiresHoursFromNow: number | null;
  /** Required when status=accepted; must be an existing foundation participation. */
  participationId: string | null;
  createdHoursAgo: number;
};

export type DemoGameChatMember = {
  userOrdinal: number;
  role: "manager" | "member";
  readThroughSeq: number;
};

export type DemoGameChatSeed = {
  id: string;
  gameOrdinal: number;
  lifecycleState: "active" | "closed";
  members: DemoGameChatMember[];
  messages: DemoSeedMessage[];
};

export type DemoSocialPopulation = {
  dmThreads: DemoDmThread[];
  invitations: DemoInvitationSeed[];
  gameChats: DemoGameChatSeed[];
  messageCount: number;
  pairOrdinalKeys: Array<readonly [number, number]>;
};

function msg(
  index: number,
  authorOrdinal: number,
  bodyText: string,
  createdHoursAgo: number,
): DemoSeedMessage {
  return {
    id: demoMessageId(index),
    authorOrdinal,
    bodyText,
    createdHoursAgo,
  };
}

function pair(a: number, b: number): string {
  return demoSocialPairId(a, b);
}

/**
 * Varied DM / invitation / game-chat content for Inbox and social screens.
 * Person 18 remains social-ineligible and is never a DM/invitation party.
 */
export function buildDemoSocialPopulation(): DemoSocialPopulation {
  let messageIndex = 1;
  const nextMsg = (
    authorOrdinal: number,
    bodyText: string,
    createdHoursAgo: number,
  ): DemoSeedMessage => {
    const row = msg(messageIndex, authorOrdinal, bodyText, createdHoursAgo);
    messageIndex += 1;
    return row;
  };

  const dmThreads: DemoDmThread[] = [
    {
      id: demoDmConversationId(1),
      pairId: pair(1, 2),
      initiatorOrdinal: 1,
      recipientOrdinal: 2,
      requestState: "accepted",
      requestExpiresHoursFromNow: null,
      messages: [
        nextMsg(1, "Привет! Сыграем в пятницу на Demo Friday Doubles?", 30),
        nextMsg(2, "Да, с удовольствием. Какой уровень ожидают?", 28),
        nextMsg(1, "Около 3.0–3.5, дружеский микс.", 26),
        nextMsg(2, "Отлично, тогда до пятницы.", 20),
      ],
      initiatorReadThrough: 4,
      recipientReadThrough: 2, // unread for Maria
    },
    {
      id: demoDmConversationId(2),
      pairId: pair(3, 4),
      initiatorOrdinal: 3,
      recipientOrdinal: 4,
      requestState: "accepted",
      requestExpiresHoursFromNow: null,
      messages: [
        nextMsg(3, "Иван здесь. Можем разогреться перед Demo Beginner Mix?", 18),
        nextMsg(4, "Да, буду на Taganka за 20 минут.", 16),
        nextMsg(3, "Супер, у кортов у входа.", 14),
      ],
      initiatorReadThrough: 3,
      recipientReadThrough: 3,
    },
    {
      id: demoDmConversationId(3),
      pairId: pair(5, 6),
      initiatorOrdinal: 5,
      recipientOrdinal: 6,
      requestState: "accepted",
      requestExpiresHoursFromNow: null,
      messages: [
        nextMsg(5, "Ольга, клиника в субботу ещё актуальна?", 22),
        nextMsg(6, "Да, место подтверждено. Возьми ракетку полегче.", 21),
      ],
      initiatorReadThrough: 2,
      recipientReadThrough: 1,
    },
    {
      id: demoDmConversationId(4),
      pairId: pair(7, 8),
      initiatorOrdinal: 7,
      recipientOrdinal: 8,
      requestState: "accepted",
      requestExpiresHoursFromNow: null,
      messages: [
        nextMsg(7, "Катя, поедем вместе на Community Open?", 12),
        nextMsg(8, "Да. Во сколько встречаемся?", 11),
        nextMsg(7, "За час до старта у метро.", 10),
        nextMsg(8, "Ок. Возьму воланы.", 9),
        nextMsg(7, "Спасибо! До встречи.", 8),
      ],
      initiatorReadThrough: 5,
      recipientReadThrough: 3,
    },
    {
      id: demoDmConversationId(5),
      pairId: pair(1, 3),
      initiatorOrdinal: 1,
      recipientOrdinal: 3,
      requestState: "accepted",
      requestExpiresHoursFromNow: null,
      messages: [
        nextMsg(1, "Иван, уточни по Demo Friday — кто ещё из подтверждённых?", 7),
        nextMsg(3, "Пока мы с Анной. Места ещё есть.", 6),
      ],
      initiatorReadThrough: 2,
      recipientReadThrough: 2,
    },
    {
      id: demoDmConversationId(6),
      pairId: pair(9, 10),
      initiatorOrdinal: 9,
      recipientOrdinal: 10,
      requestState: "pending",
      requestExpiresHoursFromNow: 48,
      messages: [
        nextMsg(9, "Дарья, можем познакомиться перед игрой? Ищу пару на doubles.", 5),
      ],
      initiatorReadThrough: 1,
      recipientReadThrough: 0,
    },
    {
      id: demoDmConversationId(7),
      pairId: pair(11, 12),
      initiatorOrdinal: 11,
      recipientOrdinal: 12,
      requestState: "pending",
      requestExpiresHoursFromNow: 36,
      messages: [
        nextMsg(11, "Полина, видел твой looking — сыграем midweek?", 4),
      ],
      initiatorReadThrough: 1,
      recipientReadThrough: 0,
    },
    {
      id: demoDmConversationId(8),
      pairId: pair(13, 14),
      initiatorOrdinal: 13,
      recipientOrdinal: 14,
      requestState: "declined",
      requestExpiresHoursFromNow: null,
      messages: [
        nextMsg(13, "Алина, есть пара на Advanced Doubles?", 40),
      ],
      initiatorReadThrough: 1,
      recipientReadThrough: 1,
    },
    {
      id: demoDmConversationId(9),
      pairId: pair(15, 16),
      initiatorOrdinal: 15,
      recipientOrdinal: 16,
      requestState: "pending",
      requestExpiresHoursFromNow: -6, // effective expired in Inbox projection
      messages: [
        nextMsg(15, "София, запрос мог протухнуть — напиши, если ещё актуально.", 50),
      ],
      initiatorReadThrough: 1,
      recipientReadThrough: 0,
    },
    {
      id: demoDmConversationId(10),
      pairId: pair(2, 7),
      initiatorOrdinal: 2,
      recipientOrdinal: 7,
      requestState: "accepted",
      requestExpiresHoursFromNow: null,
      messages: [
        nextMsg(2, "Сергей, можешь подстраховать на Demo Saturday?", 3),
        nextMsg(7, "Могу. Напишу за час до старта.", 2),
        nextMsg(2, "Спасибо!", 1),
      ],
      initiatorReadThrough: 3,
      recipientReadThrough: 1,
    },
  ];

  const invitations: DemoInvitationSeed[] = [
    {
      id: demoGameInvitationId(1),
      pairId: pair(1, 15),
      gameOrdinal: 1,
      inviterOrdinal: 1,
      inviteeOrdinal: 15,
      status: "pending",
      expiresHoursFromNow: 72,
      participationId: null,
      createdHoursAgo: 10,
    },
    {
      id: demoGameInvitationId(2),
      pairId: pair(2, 16),
      gameOrdinal: 2,
      inviterOrdinal: 2,
      inviteeOrdinal: 16,
      status: "pending",
      expiresHoursFromNow: 60,
      participationId: null,
      createdHoursAgo: 9,
    },
    {
      id: demoGameInvitationId(3),
      pairId: pair(1, 3),
      gameOrdinal: 1,
      inviterOrdinal: 1,
      inviteeOrdinal: 3,
      status: "accepted",
      expiresHoursFromNow: null,
      participationId: demoParticipationId(1), // confirmed on game 1
      createdHoursAgo: 40,
    },
    {
      id: demoGameInvitationId(4),
      pairId: pair(3, 14),
      gameOrdinal: 3,
      inviterOrdinal: 3,
      inviteeOrdinal: 14,
      status: "declined",
      expiresHoursFromNow: null,
      participationId: null,
      createdHoursAgo: 35,
    },
    {
      id: demoGameInvitationId(5),
      pairId: pair(4, 15),
      gameOrdinal: 4,
      inviterOrdinal: 4,
      inviteeOrdinal: 15,
      status: "pending",
      expiresHoursFromNow: -12, // effective expired
      participationId: null,
      createdHoursAgo: 48,
    },
    {
      id: demoGameInvitationId(6),
      pairId: pair(5, 16),
      gameOrdinal: 5,
      inviterOrdinal: 5,
      inviteeOrdinal: 16,
      status: "revoked",
      expiresHoursFromNow: null,
      participationId: null,
      createdHoursAgo: 30,
    },
    {
      id: demoGameInvitationId(7),
      pairId: pair(7, 14),
      gameOrdinal: 7,
      inviterOrdinal: 7,
      inviteeOrdinal: 14,
      status: "pending",
      expiresHoursFromNow: 96,
      participationId: null,
      createdHoursAgo: 6,
    },
    {
      id: demoGameInvitationId(8),
      pairId: pair(8, 5),
      gameOrdinal: 8,
      inviterOrdinal: 8,
      inviteeOrdinal: 5,
      status: "accepted",
      expiresHoursFromNow: null,
      participationId: demoParticipationId(21), // confirmed on game 8
      createdHoursAgo: 28,
    },
  ];

  const gameChats: DemoGameChatSeed[] = [
    chat(1, "active", [
      { userOrdinal: 1, role: "manager", readThroughSeq: 3 },
      { userOrdinal: 2, role: "manager", readThroughSeq: 2 },
      { userOrdinal: 3, role: "member", readThroughSeq: 1 },
      { userOrdinal: 4, role: "member", readThroughSeq: 3 },
    ], [
      nextMsg(1, "Всем привет! Demo Friday Doubles — пишите, если опаздываете.", 15),
      nextMsg(3, "Буду вовремя. Нужны ли воланы?", 14),
      nextMsg(1, "По две штуки на пару хватит.", 13),
    ]),
    chat(2, "active", [
      { userOrdinal: 2, role: "manager", readThroughSeq: 2 },
      { userOrdinal: 6, role: "member", readThroughSeq: 0 },
    ], [
      nextMsg(2, "Суббота утро: корт 2, вход со стороны Presnya.", 11),
      nextMsg(6, "Ок, буду к 10:45.", 10),
    ]),
    chat(3, "active", [
      { userOrdinal: 3, role: "manager", readThroughSeq: 3 },
      { userOrdinal: 7, role: "member", readThroughSeq: 3 },
      { userOrdinal: 12, role: "member", readThroughSeq: 2 },
      { userOrdinal: 13, role: "member", readThroughSeq: 1 },
    ], [
      nextMsg(3, "Beginner Mix: начинаем с разминки 10 минут.", 9),
      nextMsg(7, "Есть новички — давайте без жёсткого счёта первые геймы.", 8),
      nextMsg(12, "Согласна.", 7),
    ]),
    chat(4, "active", [
      { userOrdinal: 4, role: "manager", readThroughSeq: 2 },
      { userOrdinal: 6, role: "manager", readThroughSeq: 2 },
      { userOrdinal: 8, role: "member", readThroughSeq: 1 },
    ], [
      nextMsg(4, "Evening Rally: уровень 3.5+, просим без новичков.", 12),
      nextMsg(8, "Принято. Буду с 19:00.", 11),
    ]),
    chat(5, "active", [
      { userOrdinal: 5, role: "manager", readThroughSeq: 3 },
      { userOrdinal: 2, role: "member", readThroughSeq: 2 },
      { userOrdinal: 3, role: "member", readThroughSeq: 3 },
    ], [
      nextMsg(5, "Клиника: принесите удобную обувь для зала.", 16),
      nextMsg(2, "Можно ли записать заметки по технике?", 15),
      nextMsg(5, "Да, после блока разберём 2–3 удара.", 14),
    ]),
    chat(6, "active", [
      { userOrdinal: 6, role: "manager", readThroughSeq: 1 },
      { userOrdinal: 11, role: "member", readThroughSeq: 0 },
    ], [
      nextMsg(6, "SPB singles midweek: корт на Васильевском, час.", 8),
    ]),
    chat(7, "active", [
      { userOrdinal: 7, role: "manager", readThroughSeq: 4 },
      { userOrdinal: 1, role: "member", readThroughSeq: 3 },
      { userOrdinal: 8, role: "member", readThroughSeq: 2 },
      { userOrdinal: 9, role: "member", readThroughSeq: 4 },
    ], [
      nextMsg(7, "Community Open: много мест, зовите друзей.", 20),
      nextMsg(1, "Я уже confirmed. Нужна помощь с сеткой?", 19),
      nextMsg(8, "Могу помочь с записью на месте.", 18),
      nextMsg(7, "Отлично, спасибо.", 17),
    ]),
    chat(8, "active", [
      { userOrdinal: 8, role: "manager", readThroughSeq: 2 },
      { userOrdinal: 5, role: "member", readThroughSeq: 1 },
      { userOrdinal: 12, role: "member", readThroughSeq: 2 },
    ], [
      nextMsg(8, "SPB Advanced Doubles — темп выше обычного.", 13),
      nextMsg(5, "Готов. Возьму запасную струну.", 12),
    ]),
    chat(9, "active", [
      { userOrdinal: 1, role: "manager", readThroughSeq: 2 },
      { userOrdinal: 6, role: "member", readThroughSeq: 1 },
    ], [
      nextMsg(1, "Coaching Hour: фокус на подаче и приёме.", 10),
      nextMsg(6, "Буду с блокнотом.", 9),
    ]),
    chat(10, "active", [
      { userOrdinal: 3, role: "manager", readThroughSeq: 2 },
      { userOrdinal: 14, role: "member", readThroughSeq: 2 },
      { userOrdinal: 15, role: "member", readThroughSeq: 1 },
    ], [
      nextMsg(3, "SPB unlisted friends set — ссылку не публикуем.", 7),
      nextMsg(14, "Ок, только наш круг.", 6),
    ]),
    chat(11, "active", [
      { userOrdinal: 4, role: "manager", readThroughSeq: 3 },
      { userOrdinal: 2, role: "member", readThroughSeq: 2 },
      { userOrdinal: 5, role: "member", readThroughSeq: 3 },
      { userOrdinal: 6, role: "member", readThroughSeq: 1 },
    ], [
      nextMsg(4, "Nearly Full Court: осталось мало мест.", 5),
      nextMsg(2, "Я confirmed.", 4),
      nextMsg(5, "Тоже на месте.", 3),
    ]),
    chat(12, "closed", [
      { userOrdinal: 2, role: "manager", readThroughSeq: 1 },
    ], [
      nextMsg(2, "Игра отменена из‑за погоды. Перенесём позже.", 60),
    ]),
    chat(14, "active", [
      { userOrdinal: 7, role: "manager", readThroughSeq: 2 },
      { userOrdinal: 10, role: "member", readThroughSeq: 1 },
      { userOrdinal: 15, role: "member", readThroughSeq: 2 },
    ], [
      nextMsg(7, "Sunday Social — формат свободный, приходите знакомиться.", 2),
      nextMsg(10, "Буду после обеда.", 1),
    ]),
    chat(15, "active", [
      { userOrdinal: 11, role: "manager", readThroughSeq: 2 },
      { userOrdinal: 12, role: "member", readThroughSeq: 1 },
      { userOrdinal: 13, role: "member", readThroughSeq: 2 },
    ], [
      nextMsg(11, "Neva Doubles: встречаемся у входа на Васильевский.", 4),
      nextMsg(12, "Буду за 15 минут.", 3),
    ]),
    chat(16, "active", [
      { userOrdinal: 12, role: "manager", readThroughSeq: 2 },
      { userOrdinal: 13, role: "manager", readThroughSeq: 1 },
      { userOrdinal: 11, role: "member", readThroughSeq: 0 },
    ], [
      nextMsg(12, "Petrograd Mix: уровень смешанный, без жёсткого счёта.", 5),
      nextMsg(11, "Ок, приеду с Петроградской.", 4),
    ]),
    chat(17, "active", [
      { userOrdinal: 5, role: "manager", readThroughSeq: 3 },
      { userOrdinal: 11, role: "member", readThroughSeq: 2 },
      { userOrdinal: 12, role: "member", readThroughSeq: 3 },
    ], [
      nextMsg(5, "SPB Trainer Clinic: блок подачи и приёма.", 6),
      nextMsg(11, "Можно ли записать заметки?", 5),
      nextMsg(5, "Да, после разберём 2–3 удара.", 4),
    ]),
    chat(18, "active", [
      { userOrdinal: 14, role: "manager", readThroughSeq: 2 },
      { userOrdinal: 13, role: "member", readThroughSeq: 1 },
      { userOrdinal: 15, role: "member", readThroughSeq: 2 },
    ], [
      nextMsg(14, "Evening Rally SPB: 3.5+, просим без новичков.", 3),
      nextMsg(13, "Принято.", 2),
    ]),
    chat(19, "active", [
      { userOrdinal: 15, role: "manager", readThroughSeq: 3 },
      { userOrdinal: 11, role: "member", readThroughSeq: 2 },
      { userOrdinal: 12, role: "member", readThroughSeq: 3 },
    ], [
      nextMsg(15, "Community Open SPB: много мест, зовите друзей.", 3),
      nextMsg(11, "Я уже confirmed.", 2),
      nextMsg(12, "Тоже буду.", 1),
    ]),
    chat(20, "closed", [
      { userOrdinal: 16, role: "manager", readThroughSeq: 1 },
    ], [
      nextMsg(16, "Игра отменена из‑за паводка. Перенесём позже.", 55),
    ]),
  ];

  const pairKeys = new Map<string, readonly [number, number]>();
  const remember = (a: number, b: number) => {
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    pairKeys.set(`${low}:${high}`, [low, high] as const);
  };
  for (const thread of dmThreads) {
    remember(thread.initiatorOrdinal, thread.recipientOrdinal);
  }
  for (const invitation of invitations) {
    remember(invitation.inviterOrdinal, invitation.inviteeOrdinal);
  }

  // Sanity: no social-ineligible person 18; no self-pairs; capacity-safe accepted invites.
  for (const thread of dmThreads) {
    assertEligibleParty(thread.initiatorOrdinal);
    assertEligibleParty(thread.recipientOrdinal);
    if (thread.messages.length === 0) {
      throw new Error(`DM ${thread.id} needs at least one message`);
    }
    if (thread.requestState === "pending" && thread.requestExpiresHoursFromNow === null) {
      throw new Error(`pending DM ${thread.id} requires expiry`);
    }
  }
  for (const invitation of invitations) {
    assertEligibleParty(invitation.inviterOrdinal);
    assertEligibleParty(invitation.inviteeOrdinal);
    if (invitation.status === "pending" && invitation.expiresHoursFromNow === null) {
      throw new Error(`pending invitation ${invitation.id} requires expiry`);
    }
    if (invitation.status === "accepted" && !invitation.participationId) {
      throw new Error(`accepted invitation ${invitation.id} requires participation`);
    }
  }
  for (const gameChat of gameChats) {
    if (gameChat.messages.some((m) => !gameChat.members.some((mem) => mem.userOrdinal === m.authorOrdinal))) {
      throw new Error(`game chat ${gameChat.gameOrdinal} message author not a member`);
    }
  }

  return {
    dmThreads,
    invitations,
    gameChats,
    messageCount: messageIndex - 1,
    pairOrdinalKeys: [...pairKeys.values()],
  };
}

function chat(
  gameOrdinal: number,
  lifecycleState: "active" | "closed",
  members: DemoGameChatMember[],
  messages: DemoSeedMessage[],
): DemoGameChatSeed {
  return {
    id: demoGameConversationId(gameOrdinal),
    gameOrdinal,
    lifecycleState,
    members,
    messages,
  };
}

function assertEligibleParty(ordinal: number): void {
  if (ordinal === 18) {
    throw new Error("person 18 is social-ineligible and cannot join social seed");
  }
  if (ordinal < 1 || ordinal > 20) {
    throw new Error(`ordinal out of demo population: ${ordinal}`);
  }
}

export function demoClientMessageId(messageId: string): string {
  return `demo-social:${messageId}`;
}

export function hoursFromNowDate(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export function hoursAgoDate(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

export function resolveDemoUser(ordinal: number): string {
  return demoUserId(ordinal);
}

export function resolveDemoGame(ordinal: number): string {
  return demoGameId(ordinal);
}
