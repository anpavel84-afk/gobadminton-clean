import { describe, expect, it, vi } from "vitest";
import { GameRecommendationsController } from "../../src/game-recommendations/game-recommendations.controller";
import { assertDecision, decisionRequest, listQuery, parse, sendRequest, type RecommendationRow } from "../../src/game-recommendations/game-recommendations.policy";
import { effectiveAccepted, type Availability, type FriendshipRow } from "../../src/friendships/friendships.policy";
import { ConsumerAuthService } from "../../src/auth/consumer-auth.service";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { loadEnv } from "../../src/config/env";
const a="10000000-0000-4000-8000-000000000001",b="10000000-0000-4000-8000-000000000002";
const id="10000000-0000-4000-8000-000000000003";
const row:RecommendationRow={id,friendship_id:id,friendship_generation:"1",game_id:id,sender_user_id:a,
  recipient_user_id:b,sender_epoch:"1",recipient_epoch:"1",state:"active",recipient_hidden:false,
  version:1,created_at:new Date(),expires_at:new Date(Date.now()+10000)};
const profile=(user:string):Availability=>({user_id:user,public_player_id:user,display_name:"Synthetic",
  social_action_epoch:"1",directory_visible:true,social_eligible:true,contact_policy:"requests",status:"active",unrestricted:true});
const friendship:FriendshipRow={id,pair_id:id,requester_user_id:a,recipient_user_id:b,request_id:id,generation:"1",
  version:"2",state:"accepted",requester_epoch:"1",recipient_epoch:"1",requested_at:new Date(),expires_at:null,accepted_at:new Date()};
const env=loadEnv({NODE_ENV:"test",APP_ENV:"local",DATABASE_URL:"postgres://synthetic:synthetic@127.0.0.1/synthetic",
  PUBLIC_API_ORIGIN:"http://127.0.0.1:3000",PUBLIC_WEB_ORIGIN:"http://127.0.0.1:3001"});
describe("FR-3A strict transport, role and current relationship policies",()=>{
  it("accepts exactly one friendship ID, never a user/public ID, message or batch",()=>{
    expect(parse(sendRequest,{friendshipId:id})).toEqual({friendshipId:id});
    for (const input of [{},{friendshipId:[id]},{friendshipIds:[id]},{targetPublicPlayerId:id},
      {friendshipId:id,actorId:a},{friendshipId:id,recipientUserId:b},{friendshipId:id,message:"private"}]) {
      expect(()=>parse(sendRequest,input)).toThrow();
    }
  });
  it("uses a bounded numeric version and rejects implicit coercion",()=>{
    expect(parse(decisionRequest,{expectedVersion:2147483647})).toEqual({expectedVersion:2147483647});
    for (const expectedVersion of ["1",0,-1,1.1,2147483648,null]) expect(()=>parse(decisionRequest,{expectedVersion})).toThrow();
    expect(()=>parse(decisionRequest,{expectedVersion:1,gameId:id})).toThrow();
  });
  it("strict own views and <=20 page limit",()=>{
    expect(parse(listQuery,{view:"received"}).limit).toBe(20);
    expect(parse(listQuery,{view:"sent",limit:"1"}).limit).toBe(1);
    for (const input of [{view:"all"},{view:"received",limit:21},{view:"sent",limit:0},
      {view:"sent",userId:a},{view:"sent",cursor:""},{view:"received",limit:"1x"}]) expect(()=>parse(listQuery,input)).toThrow();
  });
  it("hide is recipient only; withdraw is sender only; stale and terminal writes fail",()=>{
    expect(()=>assertDecision(row,b,"hide",1)).not.toThrow();
    expect(()=>assertDecision(row,a,"withdraw",1)).not.toThrow();
    for (const actor of [a,id]) expect(()=>assertDecision(row,actor,"hide",1)).toThrow();
    for (const actor of [b,id]) expect(()=>assertDecision(row,actor,"withdraw",1)).toThrow();
    expect(()=>assertDecision(row,a,"withdraw",2)).toThrow();
    expect(()=>assertDecision({...row,state:"withdrawn"},a,"withdraw",1)).toThrow();
    expect(()=>assertDecision({...row,recipient_hidden:true},b,"hide",1)).toThrow();
    expect(()=>assertDecision({...row,version:2147483647},a,"withdraw",2147483647)).toThrow();
  });
  it("accepted is revalidated for both profiles, bilateral block and epochs",()=>{
    const profiles=[profile(a),profile(b)];
    expect(effectiveAccepted(friendship,profiles,false)).toBe(true);
    expect(effectiveAccepted(friendship,profiles,true)).toBe(false);
    for (const state of ["pending","declined","removed","blocked","expired"]) {
      expect(effectiveAccepted({...friendship,state},profiles,false)).toBe(false);
    }
    for (const index of [0,1]) for (const change of [{social_action_epoch:"2"},{directory_visible:false},
      {social_eligible:false},{status:"disabled"},{status:"deletion_pending"},{unrestricted:false}]) {
      const changed=profiles.map((p,i)=>i===index?{...p,...change}:p);
      expect(effectiveAccepted(friendship,changed,false)).toBe(false);
    }
    // Direct-message opt-out alone must not revoke an accepted friendship.
    // The recorded epoch still prevents resurrection after a policy change.
    expect(effectiveAccepted(friendship,[profiles[0]!,{...profiles[1]!,contact_policy:"closed"}],false)).toBe(true);
    expect(effectiveAccepted(friendship,[profiles[0]!,{...profiles[1]!,contact_policy:"closed",social_action_epoch:"2"}],false)).toBe(false);
    expect(effectiveAccepted(friendship,[profile(a)],false)).toBe(false);
  });
  it.each([
    {headers:{origin:env.PUBLIC_WEB_ORIGIN,"x-csrf-token":"ok"},cookies:{}},
    {headers:{origin:env.PUBLIC_WEB_ORIGIN},cookies:{[SESSION_COOKIE]:"s"}},
    {headers:{origin:"https://evil.invalid","x-csrf-token":"ok"},cookies:{[SESSION_COOKIE]:"s"}},
    {headers:{origin:env.PUBLIC_WEB_ORIGIN,"x-csrf-token":"bad"},cookies:{[SESSION_COOKIE]:"s"}},
    {headers:{origin:env.PUBLIC_WEB_ORIGIN,"x-csrf-token":"ok",authorization:"Bearer s"},cookies:{[SESSION_COOKIE]:"s"}},
  ])("auth rejects before service: %j",async request=>{
    const auth=new ConsumerAuthService(env,{lookupActiveSession:async()=>({userId:a,id:b}),
      verifyCsrf:async(_:string,token:string)=>token==="ok"} as never,{getUser:async()=>({id:a,status:"active"})} as never);
    const send=vi.fn();const controller=new GameRecommendationsController(auth,new IdempotencyService({} as never,env),{send} as never);
    await expect(controller.send({...request,body:{friendshipId:id}} as never,{status:vi.fn()} as never,id)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it("preserves the authenticated actor, session and idempotency key; unknown outcome is no receipt",async()=>{
    const auth={requireCookieMutation:vi.fn().mockResolvedValue({userId:a,sessionId:b})};
    const send=vi.fn().mockResolvedValue({statusCode:201,body:{id,version:1,outcome:"sent"}});
    const controller=new GameRecommendationsController(auth as never,new IdempotencyService({} as never,env),{send} as never);
    const body={friendshipId:id},reply={status:vi.fn()};
    const request={headers:{"idempotency-key":"fr3a-synthetic-key-12345"},body};
    expect(await controller.send(request as never,reply as never,id)).toEqual({id,version:1,outcome:"sent"});
    expect(send).toHaveBeenCalledWith(a,b,"fr3a-synthetic-key-12345",id,body);
    expect(reply.status).toHaveBeenCalledWith(201);
    send.mockRejectedValue(new Error("unknown commit"));reply.status.mockClear();
    await expect(controller.send(request as never,reply as never,id)).rejects.toThrow("unknown commit");
    expect(reply.status).not.toHaveBeenCalled();
  });
});
