import { sameActor } from './participation.ts';
import type { Actor } from './participation.ts';
import type { PlayerFilters, PublicPlayer, PlayerPage } from './players.ts';
import { playerFilterKey, resetPlayerFilters } from './players.ts';
import { interestCommand, parsePlayInterestReceipt, parsePlayInterestStates, PlayInterestError } from './play-interests.ts';
import type { PlayInterestPacket, PlayInterestView, PlayInterestReceipt } from './play-interests.ts';
export type MatchIdentity = Pick<PublicPlayer,'publicPlayerId'|'displayName'|'avatar'>;
export type FriendlyMatch = Readonly<{actor:Readonly<Actor>;episode:number;self:MatchIdentity;peer:MatchIdentity;receipt:PlayInterestReceipt}>;
type Command = {packet:PlayInterestPacket;status:'sending'|'unknown';episode:number;self:MatchIdentity;peer:MatchIdentity};
export type BrowseSnapshot = {actor:Actor|null;episode:number;active:boolean;foreground:boolean;filters:PlayerFilters;
  page:PlayerPage|null;selected:string|null;states:ReadonlyMap<string,PlayInterestView>;reading:boolean;
  command:Command|null;match:FriendlyMatch|null;notice:string|null};
export type PlayInterestPort = {read:(ids:readonly string[],actor:Actor)=>Promise<unknown>;send:(packet:PlayInterestPacket,permit:()=>boolean)=>Promise<unknown>;random:()=>string};
const identity = (p:MatchIdentity):MatchIdentity => ({publicPlayerId:p.publicPlayerId,displayName:p.displayName,...(p.avatar ? {avatar:{...p.avatar}} : {})});
/** Root owner outlives a card and its route. Only explicit commands dispatch, never mount/login/foreground. */
export class PlayInterestCoordinator {
  private state:BrowseSnapshot = {actor:null,episode:0,active:false,foreground:true,filters:resetPlayerFilters(),page:null,selected:null,
    states:new Map(),reading:false,command:null,match:null,notice:null};
  private listeners = new Set<()=>void>();
  private sequence = 0;
  private authority = 0;
  private seen = new Set<string>();
  // Private packets from retired authority cannot be replayed by a later session (including same actor).
  private quarantine:Command[] = [];
  private port: PlayInterestPort;
  constructor(port:PlayInterestPort) { this.port=port; }
  getSnapshot = () => this.state;
  subscribe = (fn:()=>void) => {this.listeners.add(fn);return () => {this.listeners.delete(fn);};};
  private show(p:Partial<BrowseSnapshot>) {this.state={...this.state,...p};this.listeners.forEach(fn=>fn());}
  setActor(actor:Actor|null) {
    if (sameActor(actor,this.state.actor) || !actor && !this.state.actor) return;
    if (this.state.command) this.quarantine.push(this.state.command);
    this.authority++;
    this.sequence++;
    this.show({actor:actor ? {...actor} : null,episode:this.state.episode+1,states:new Map(),reading:false,
      command:null,match:null,notice:null,page:null});
  }
  stage(filters:PlayerFilters,page:PlayerPage|null) {
    const changed=playerFilterKey(filters)!==playerFilterKey(this.state.filters);
    this.show({filters:{...filters},page:page ? {items:[...page.items],nextCursor:page.nextCursor} : null,
      selected:changed ? page?.items[0]?.publicPlayerId ?? null : this.state.selected ?? page?.items[0]?.publicPlayerId ?? null,
      ...(changed ? {episode:this.state.episode+1,states:new Map(),match:null} : {})});
  }
  catalog(page:PlayerPage|null) {
    if(page===this.state.page)return;
    const ids=new Set(page?.items.map(p=>p.publicPlayerId) ?? []);
    const removed=this.state.page?.items.some(p=>!ids.has(p.publicPlayerId)) ?? false;
    if(removed)this.authority++;
    const states=new Map([...this.state.states].filter(([id])=>ids.has(id)));
    this.show({page,states,selected:ids.has(this.state.selected ?? '') ? this.state.selected : page?.items[0]?.publicPlayerId ?? this.state.selected,
      ...(removed ? {episode:this.state.episode+1,match:null} : {})});
  }
  enter = () => {this.show({active:true,episode:this.state.episode+1,match:null});};
  exit = () => {this.sequence++;this.show({active:false,episode:this.state.episode+1,match:null,states:new Map(),reading:false});};
  setForeground = (foreground:boolean) => {if(foreground===this.state.foreground)return;this.sequence++;this.show({foreground,episode:this.state.episode+1,match:null,states:new Map(),reading:false});};
  dismiss = () => this.show({match:null});
  select = (selected:string,episode=this.state.episode) => {
    if(episode!==this.state.episode || !this.state.active || !this.state.page?.items.some(p=>p.publicPlayerId===selected))return;
    this.show({selected});
  };
  invalidate = () => {this.authority++;this.sequence++;this.show({episode:this.state.episode+1,states:new Map(),reading:false,match:null,notice:'Доступность изменилась. Проверьте снова.'});};
  refresh = async (ids:readonly string[]) => {
    const actor=this.state.actor,episode=this.state.episode,sequence=++this.sequence;
    if(!actor || !this.state.active || !this.state.foreground || !ids.length)return;
    const frozen=Object.freeze([...ids]);this.show({states:new Map(),reading:true,notice:null});
    try {
      const states=parsePlayInterestStates(await this.port.read(frozen,actor),frozen);
      if(sequence!==this.sequence || !sameActor(actor,this.state.actor) || episode!==this.state.episode)return;
      const match=this.state.match;
      this.show({states,reading:false,...(match && states.has(match.peer.publicPlayerId) && states.get(match.peer.publicPlayerId)?.relationship!=='mutual' ? {match:null} : {})});
    } catch {
      if(sequence===this.sequence && sameActor(actor,this.state.actor))this.show({states:new Map(),reading:false,notice:'Не удалось проверить предложения. Повторите проверку.'});
    }
  };
  act = async (kind:'send'|'withdraw',target:string,episode:number,self:MatchIdentity) => {
    const s=this.state,peer=s.page?.items.find(p=>p.publicPlayerId===target),view=s.states.get(target);
    if(!s.actor || !s.active || !s.foreground || s.command || s.match || episode!==s.episode || target!==s.selected || !peer || !view || !self.publicPlayerId || !self.displayName)return;
    if(this.quarantine.some(c=>c.packet.actor.actorId===s.actor!.actorId)){
      this.show({notice:'Предыдущий запрос сохранён в прежнем сеансе с неизвестным результатом. Новый запрос не отправлен.'});return;
    }
    const wire=interestCommand(view,target,kind);if(!wire)return;
    const packet=Object.freeze({...wire,actor:Object.freeze({...s.actor}),target,key:this.port.random(),body:Object.freeze({...wire.body})}) as PlayInterestPacket;
    const command:Command={packet,status:'sending',episode,self:identity(self),peer:identity(peer)};
    this.show({command,notice:null});return await this.dispatch(command);
  };
  reconcile = async () => {
    const c=this.state.command;
    if(!c || c.status!=='unknown' || !sameActor(c.packet.actor,this.state.actor) || !this.state.active || !this.state.foreground)return;
    // Original immutable body/version/key. Current state GET never substitutes for a mutation receipt.
    await this.dispatch(c);
  };
  private async dispatch(command:Command) {
    const packet=command.packet;
    const authority=this.authority;
    this.show({command:{...command,status:'sending'}});
    const valid=()=>sameActor(packet.actor,this.state.actor) && this.state.command?.packet===packet;
    try {
      const receipt=parsePlayInterestReceipt(await this.port.send(packet,()=>valid() && authority===this.authority),packet.kind);
      if(!valid()){
        this.quarantine=this.quarantine.filter(c=>c.packet!==packet);
        return;
      }
      const states=new Map(this.state.states);states.delete(packet.target);
      const key=JSON.stringify([packet.actor.actorId,packet.actor.sessionId,packet.actor.generation,receipt.interestId,receipt.version,packet.target]);
      const unseen=!this.seen.has(key);this.seen.add(key); // Suppressed events are consumed as well.
      const match=packet.kind==='send' && receipt.outcome==='mutual' && unseen && this.state.active && this.state.foreground &&
        command.episode===this.state.episode && !this.state.match ? Object.freeze({actor:packet.actor,episode:command.episode,self:command.self,peer:command.peer,receipt}) : null;
      this.show({command:null,states,match,notice:receipt.outcome==='withdrawn' ? 'Предложение отозвано.' : 'Предложение отправлено.'});
      return receipt;
    } catch(error) {
      if(!valid())return;
      // Explicit business refusals prove no new intent was accepted. Key conflicts/ambiguous replies remain UNKNOWN.
      const refusal=error instanceof PlayInterestError && error.kind==='refused' && !['KEY_REUSED','IDEMPOTENCY_KEY_REUSED'].includes(error.code);
      this.show({command:refusal ? null : {...command,status:'unknown'},states:new Map(),match:null,
        notice:refusal ? 'Предложение недоступно. Проверьте условия снова.' : 'Результат неизвестен. Сохранён исходный запрос; проверьте результат явно.'});
    }
  }
}
