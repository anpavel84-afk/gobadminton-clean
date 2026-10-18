import { Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { conflict, notFound } from "../auth/problem";
import { AdminService, type AdminActor } from "../admin/admin.service";
import { appendAudit } from "../admin/admin-db";
import type { VenueFields, VenueCommand } from "../admin/venues.dto";
import { extractIdentityDiscriminator, normalizeVenueText, venueDedupeKey } from "./venue-normalize";
import { effectiveVenueCtes } from "./effective-venue.query";

type Row = {contact_phone:string|null;contact_website:string|null;booking_note:string|null;id:string;city_id:string;city_name?:string;name:string;address:string;timezone:string;latitude:number;longitude:number;lifecycle_state:string;canonical_venue_id:string|null;identity_discriminator:string;version:number};
const select = "SELECT v.*, (SELECT name_ru FROM cities WHERE id=v.city_id) AS city_name, ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude FROM venues v";
const dto = (r:Row) => ({id:r.id,cityId:r.city_id,cityName:r.city_name,name:r.name,address:r.address,timezone:r.timezone,latitude:Number(r.latitude),longitude:Number(r.longitude),lifecycleState:r.lifecycle_state,canonicalVenueId:r.canonical_venue_id,identityDiscriminator:r.identity_discriminator,version:r.version});
/** Venue-owned writes. Admin supplies current authorization and one transaction. */
@Injectable()
export class AdminVenuesService {
  constructor(private readonly admin:AdminService) {}
  private async catalog(c:PoolClient) { await c.query("SELECT pg_advisory_xact_lock(hashtext('gobadminton_venue_catalog'))"); }
  private async row(c:PoolClient,id:string) { const r=(await c.query<Row>(select+" WHERE v.id=$1 FOR UPDATE",[id])).rows[0];if(!r)throw notFound("VENUE_NOT_FOUND","Площадка не найдена");return r; }
  private version(r:Row,v:number) {if(r.version!==v)throw conflict("VENUE_VERSION_CONFLICT","Площадка изменилась. Обновите данные.");}
  async list(request:FastifyRequest,page:{cityId?:string;status?:string;beforeId?:string;limit:number}) {
    return this.admin.privilegedRead(request,"venue.manage",async(c,a)=>{
      const rows=(await c.query<Row>(select+" WHERE ($1::uuid IS NULL OR city_id=$1) AND ($2::text IS NULL OR lifecycle_state=$2) AND ($3::uuid IS NULL OR id<$3) ORDER BY id DESC LIMIT $4",[page.cityId??null,page.status??null,page.beforeId??null,page.limit+1])).rows;
      await appendAudit(c,{actor:a,action:"venue.list_read",targetType:"venue",targetId:"bounded_queue",permission:"venue.manage",reason:"operations_read"});
      return {items:rows.slice(0,page.limit).map(dto),nextBeforeId:rows.length>page.limit?rows[page.limit-1]!.id:null};
    });
  }
  async detail(request:FastifyRequest,id:string,beforeVersion?:number) {
    return this.admin.privilegedRead(request,"venue.manage",async(c,a)=>{
      const row=await this.row(c,id);
      const history=(await c.query("SELECT venue_version AS version,action,created_at FROM venue_admin_actions WHERE venue_id=$1 AND ($2::int IS NULL OR venue_version<$2) ORDER BY venue_version DESC LIMIT 101",[id,beforeVersion??null])).rows;
      await appendAudit(c,{actor:a,action:"venue.detail_read",targetType:"venue",targetId:id,permission:"venue.manage",reason:"operations_read"});
      return {...dto(row),history:history.slice(0,100),nextHistoryBeforeVersion:history.length>100?history[99]!.version:null};
    });
  }
  async games(request:FastifyRequest,id:string,beforeId?:string) {
    return this.admin.privilegedRead(request,"venue.manage",async(c,a)=>{
      const rows=(await c.query("SELECT id,title,status FROM games WHERE venue_id=$1 AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT 51",[id,beforeId??null])).rows;
      await appendAudit(c,{actor:a,action:"venue.games_read",targetType:"venue",targetId:id,permission:"venue.manage",reason:"operations_read"});
      return {items:rows.slice(0,50),nextBeforeId:rows.length>50?rows[49]!.id:null};
    });
  }
  async duplicates(request:FastifyRequest,beforeId?:string) {
    return this.admin.privilegedRead(request,"venue.manage",async(c,a)=>{
      const rows=(await c.query("SELECT id,left_venue_id AS \"leftVenueId\",right_venue_id AS \"rightVenueId\",version,source FROM venue_duplicate_candidates WHERE status='open' AND ($1::uuid IS NULL OR id<$1) ORDER BY id DESC LIMIT 51",[beforeId??null])).rows;
      await appendAudit(c,{actor:a,action:"venue.duplicates_read",targetType:"venue",targetId:"duplicate_queue",permission:"venue.manage",reason:"operations_read"});
      return {items:rows.slice(0,50),nextBeforeId:rows.length>50?rows[49]!.id:null};
    });
  }
  async dismiss(request:FastifyRequest,key:string|undefined,id:string,input:{expectedVersion:number;reasonCode:string}) {
    return this.admin.privilegedCommand(request,key,"venue.manage",true,"venue.dismiss",{id,...input},async(c,a,keyHash)=>{
      await this.catalog(c);
      const result=await c.query("UPDATE venue_duplicate_candidates SET status='dismissed',version=version+1 WHERE id=$1 AND version=$2 AND status='open' RETURNING id,version",[id,input.expectedVersion]);
      if(!result.rows[0])throw conflict("VENUE_VERSION_CONFLICT","Запись проверки изменилась");
      await appendAudit(c,{actor:a,action:"venue.duplicate_dismissed",targetType:"venue_duplicate",targetId:id,permission:"venue.manage",reason:input.reasonCode,keyHash});
      return result.rows[0] as {id:string;version:number};
    });
  }
  private identity(fields:VenueFields) {
    const normalizedName=normalizeVenueText(fields.name),normalizedAddress=normalizeVenueText(fields.address),identityDiscriminator=extractIdentityDiscriminator(fields.name,fields.address,fields.identityDiscriminator);
    return {normalizedName,normalizedAddress,identityDiscriminator,key:venueDedupeKey({cityId:fields.cityId,normalizedName,normalizedAddress,identityDiscriminator})};
  }
  private async record(c:PoolClient,a:AdminActor,row:Row,action:string,reason:string,keyHash:string,before?:Row) {
    const auditId=await appendAudit(c,{actor:a,action:"venue."+action,targetType:"venue",targetId:row.id,permission:action==="merge"?"venue.merge":"venue.manage",reason,keyHash,before:before?{version:before.version,lifecycleState:before.lifecycle_state}:{},after:{version:row.version,lifecycleState:row.lifecycle_state,canonicalVenueId:row.canonical_venue_id}});
    await c.query("INSERT INTO venue_admin_actions(venue_id,venue_version,action,actor_id,audit_id) VALUES($1,$2,$3,$4,$5)",[row.id,row.version,action,a.principalId,auditId]);
    await c.query("INSERT INTO outbox_events(type,aggregate_type,aggregate_id,aggregate_version,payload) VALUES($1,'venue',$2,$3,$4::jsonb)",["venue."+action,row.id,row.version,JSON.stringify({venueId:row.id,canonicalVenueId:row.canonical_venue_id})]);
  }
  async create(request:FastifyRequest,key:string|undefined,input:VenueFields & {reasonCode:string}) {
    return this.admin.privilegedCommand(request,key,"venue.manage",true,"venue.create",input,async(c,a,keyHash)=>{
      await this.catalog(c);const n=this.identity(input);
      const existing=(await c.query("SELECT venue_id FROM venue_identity_keys WHERE dedupe_key=$1",[n.key])).rows[0];
      if(existing)throw conflict("VENUE_IDENTITY_CONFLICT","Такая площадка уже существует. Откройте каталог.");
      if(!(await c.query("SELECT id FROM cities WHERE id=$1",[input.cityId])).rowCount)throw notFound("CITY_NOT_FOUND","Город не найден");
      const id=(await c.query<{id:string}>(`INSERT INTO venues(city_id,name,address,timezone,location,data_status,provenance,lifecycle_state,normalized_name,normalized_address,identity_discriminator,created_by_user_id) VALUES($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($5,$6),4326)::geography,'verified','admin_created','verified',$7,$8,$9,$10) RETURNING id`,[input.cityId,input.name,input.address,input.timezone,input.longitude,input.latitude,n.normalizedName,n.normalizedAddress,n.identityDiscriminator,a.principal.user_id])).rows[0]!.id;
      await c.query("INSERT INTO venue_identity_keys(dedupe_key,venue_id,normalization_version) VALUES($1,$2,1)",[n.key,id]);
      const row=await this.row(c,id);await this.record(c,a,row,"create",input.reasonCode,keyHash);return dto(row);
    });
  }
  async command(request:FastifyRequest,key:string|undefined,id:string,input:VenueCommand) {
    return this.admin.privilegedCommand(request,key,input.action==="merge"?"venue.merge":"venue.manage",true,"venue."+input.action,{id,...input},async(c,a,keyHash)=>{
      await this.catalog(c);
      // Resolve the final target under the common catalog fence, then lock in UUID order.
      let targetId:string|undefined;
      if(input.action==="merge") {
        const target=(await c.query<{id:string;canonical_resolved:boolean}>(effectiveVenueCtes("SELECT id FROM venues WHERE id=$1")+" SELECT id,canonical_resolved FROM effective_venues",[input.targetId])).rows[0];
        if(!target?.canonical_resolved)throw conflict("VENUE_MERGE_CONFLICT","Целевая площадка недоступна");
        targetId=target.id;
        if(id===targetId)throw conflict("VENUE_MERGE_CONFLICT","Нельзя объединить площадку с собой");
        await c.query("SELECT id FROM venues WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",[[id,targetId]]);
      }
      const before=await this.row(c,id);this.version(before,input.expectedVersion);
      if(before.lifecycle_state==="merged")throw conflict("VENUE_MERGE_CONFLICT","Площадка уже объединена");
      if(input.action==="merge") {
        const target=await this.row(c,targetId!);this.version(target,input.expectedTargetVersion);
        if(target.city_id!==before.city_id || !["unverified","verified"].includes(target.lifecycle_state))throw conflict("VENUE_MERGE_CONFLICT","Нужна действующая площадка того же города");
        if(before.identity_discriminator!==target.identity_discriminator && (before.identity_discriminator || target.identity_discriminator))throw conflict("VENUE_DISTINCT_UNIT","Разные залы или помещения сохраняются отдельно");
        // Live references move; historical duplicate/merge/action records retain their original IDs.
        await c.query("SELECT id FROM games WHERE venue_id=$1 ORDER BY id FOR UPDATE",[id]);
        await c.query("UPDATE games SET venue_id=$2,version=version+1,updated_at=now() WHERE venue_id=$1",[id,target.id]);
        await c.query("UPDATE venue_identity_keys SET venue_id=$2 WHERE venue_id=$1",[id,target.id]);
        await c.query("UPDATE venues SET canonical_venue_id=$2,version=version+1,updated_at=now() WHERE canonical_venue_id=$1 AND lifecycle_state='merged'",[id,target.id]);
        await c.query("UPDATE venue_duplicate_candidates SET status='dismissed',version=version+1 WHERE status='open' AND (left_venue_id=$1 OR right_venue_id=$1)",[id]);
        await c.query("UPDATE venues SET lifecycle_state='merged',canonical_venue_id=$2,version=version+1,updated_at=now() WHERE id=$1",[id,target.id]);
        await c.query("UPDATE venues SET version=version+1,updated_at=now() WHERE id=$1",[target.id]);
        await c.query("INSERT INTO venue_merge_history(source_venue_id,target_venue_id,reason) VALUES($1,$2,$3)",[id,target.id,input.reasonCode]);
      } else if(input.action==="edit") {
        const f=input.fields,n=this.identity(f);
        if(f.cityId!==before.city_id)throw conflict("VENUE_CITY_IMMUTABLE","Город существующей площадки не меняется");
        const existing=(await c.query("SELECT venue_id FROM venue_identity_keys WHERE dedupe_key=$1",[n.key])).rows[0];
        if(existing && existing.venue_id!==id) {
          const pair=[id,existing.venue_id as string].sort();
          await c.query("INSERT INTO venue_duplicate_candidates(left_venue_id,right_venue_id,source) VALUES($1,$2,'legacy_exact_collision') ON CONFLICT(left_venue_id,right_venue_id,source) DO UPDATE SET status='open',version=venue_duplicate_candidates.version+1",pair);
          await appendAudit(c,{actor:a,action:"venue.edit_collision_review",targetType:"venue",targetId:id,permission:"venue.manage",reason:input.reasonCode,keyHash});
          return {...dto(before),reviewRequired:true};
        }
        const phone = f.contactPhone === undefined ? before.contact_phone : f.contactPhone || null;
        const website = f.contactWebsite === undefined ? before.contact_website : f.contactWebsite || null;
        const note = f.bookingNote === undefined ? before.booking_note : f.bookingNote || null;
        // Retain historical reservations so proposals using old keys resolve canonically.
        await c.query("INSERT INTO venue_identity_keys(dedupe_key,venue_id,normalization_version) VALUES($1,$2,1) ON CONFLICT(dedupe_key) DO NOTHING",[n.key,id]);
        await c.query("UPDATE venues SET name=$2,address=$3,timezone=$4,location=ST_SetSRID(ST_MakePoint($5,$6),4326)::geography,normalized_name=$7,normalized_address=$8,identity_discriminator=$9,contact_updated_at=CASE WHEN contact_phone IS DISTINCT FROM $10::text OR contact_website IS DISTINCT FROM $11::text OR booking_note IS DISTINCT FROM $12::text THEN now() ELSE contact_updated_at END,contact_phone=$10,contact_website=$11,booking_note=$12,provenance='admin_corrected',version=version+1,updated_at=now() WHERE id=$1",[id,f.name,f.address,f.timezone,f.longitude,f.latitude,n.normalizedName,n.normalizedAddress,n.identityDiscriminator,phone,website,note]);
      } else {
        const next=input.action==="retire"?"retired":input.action==="verify"?"verified":"unverified";
        if(input.action==="restore" ? before.lifecycle_state!=="retired" : !["unverified","verified"].includes(before.lifecycle_state))throw conflict("VENUE_STATE_CONFLICT","Действие недоступно в текущем состоянии");
        await c.query("UPDATE venues SET lifecycle_state=$2,data_status=$3,version=version+1,updated_at=now() WHERE id=$1",[id,next,next==="verified"?"verified":"unverified"]);
      }
      const row=await this.row(c,id);await this.record(c,a,row,input.action,input.reasonCode,keyHash,before);return dto(row);
    });
  }
}
