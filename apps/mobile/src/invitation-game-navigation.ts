import type { Actor, GameRead, ParticipationCoordinator } from './participation.ts';
import { sameActor } from './participation.ts';

/**
 * #522 APK47 — accepted-web InvitationDetail «Открыть игру» parity.
 * Fresh matching ParticipationCoordinator game read only; never infer access from
 * invitation status, managerEligible, acceptanceContext, or bare gameId.
 */

export type InvitationGameNavBind = Readonly<{
  invitationId: string;
  gameId: string;
  actor: Actor;
  viewGeneration: number;
}>;

export type InvitationGameNavPhase =
  | { status: 'idle' }
  | { status: 'loading'; bind: InvitationGameNavBind }
  | { status: 'ready'; bind: InvitationGameNavBind; matchedGameId: string }
  | { status: 'error'; bind: InvitationGameNavBind };

export type InvitationOpenLive = Readonly<{
  invitationId: string;
  gameId: string;
  actor: Actor | null;
}>;

/** Ready Open-game target only when this view's fresh matching read settled. */
export function invitationOpenGameTarget(
  phase: InvitationGameNavPhase,
  live: InvitationOpenLive & { viewGeneration: number },
): string | null {
  if (!live.actor || phase.status !== 'ready') return null;
  if (phase.bind.invitationId !== live.invitationId) return null;
  if (phase.bind.gameId !== live.gameId) return null;
  if (phase.bind.viewGeneration !== live.viewGeneration) return null;
  if (!sameActor(phase.bind.actor, live.actor)) return null;
  if (phase.matchedGameId !== live.gameId) return null;
  return live.gameId;
}

/** Participation GameRead may settle only with exact id match. */
export function matchingReadableGameId(gameId: string, read: GameRead | undefined): string | null {
  if (read?.status !== 'ready' || !read.game) return null;
  if (read.game.id !== gameId) return null;
  return read.game.id;
}

export function invitationGamePath(gameId: string): `/games/${string}` {
  return `/games/${gameId}`;
}

/**
 * View-local Open-game fence. Starts loading on focus — never paints ambient
 * participation cache as ready for a new invitation/actor/generation.
 */
export class InvitationGameNavController {
  private phase: InvitationGameNavPhase = { status: 'idle' };
  private serial = 0;
  private foreground = true;
  private focusedBind: InvitationGameNavBind | null = null;
  private participation: ParticipationCoordinator | null = null;
  private listeners = new Set<() => void>();

  getSnapshot = () => this.phase;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private emit() { this.listeners.forEach(fn => fn()); }

  private invalidateInFlight() {
    ++this.serial;
  }

  /** Focus lease for one invitation identity; cleanup retires the generation. */
  focus = (
    bind: { invitationId: string; gameId: string; actor: Actor },
    participation: ParticipationCoordinator,
  ) => {
    this.participation = participation;
    const viewGeneration = ++this.serial;
    const full: InvitationGameNavBind = Object.freeze({
      invitationId: bind.invitationId,
      gameId: bind.gameId,
      actor: Object.freeze({ ...bind.actor }),
      viewGeneration,
    });
    this.focusedBind = full;
    if (this.foreground) this.startLoad(full);
    else {
      this.phase = { status: 'idle' };
      this.emit();
    }
    return () => {
      if (this.focusedBind?.viewGeneration === viewGeneration) {
        this.focusedBind = null;
        this.invalidateInFlight();
        this.phase = { status: 'idle' };
        this.emit();
      }
    };
  };

  setForeground = (active: boolean) => {
    if (active === this.foreground) return;
    this.foreground = active;
    if (!active) {
      this.invalidateInFlight();
      this.phase = { status: 'idle' };
      this.emit();
      return;
    }
    if (this.focusedBind && this.participation) {
      const base = this.focusedBind;
      const viewGeneration = ++this.serial;
      const full: InvitationGameNavBind = Object.freeze({
        invitationId: base.invitationId,
        gameId: base.gameId,
        actor: base.actor,
        viewGeneration,
      });
      this.focusedBind = full;
      this.startLoad(full);
    }
  };

  openGameId = (live: InvitationOpenLive): string | null => {
    if (!this.foreground || !this.focusedBind) return null;
    return invitationOpenGameTarget(this.phase, {
      invitationId: live.invitationId,
      gameId: live.gameId,
      actor: live.actor,
      viewGeneration: this.focusedBind.viewGeneration,
    });
  };

  mayOpen = (gameId: string, live: InvitationOpenLive) => this.openGameId(live) === gameId;

  private startLoad(bind: InvitationGameNavBind) {
    this.phase = { status: 'loading', bind };
    this.emit();
    const participation = this.participation;
    if (!participation) {
      this.phase = { status: 'error', bind };
      this.emit();
      return;
    }
    void (async () => {
      const still = () =>
        this.foreground
        && !!this.focusedBind
        && this.focusedBind.viewGeneration === bind.viewGeneration
        && this.focusedBind.invitationId === bind.invitationId
        && this.focusedBind.gameId === bind.gameId
        && sameActor(this.focusedBind.actor, bind.actor);
      if (!still()) return;
      await participation.loadGame(bind.gameId);
      if (!still()) return;
      if (!sameActor(participation.getSnapshot().actor, bind.actor)) return;
      const matched = matchingReadableGameId(bind.gameId, participation.getSnapshot().games[bind.gameId]);
      if (!still()) return;
      this.phase = matched
        ? { status: 'ready', bind, matchedGameId: matched }
        : { status: 'error', bind };
      this.emit();
    })();
  }
}
