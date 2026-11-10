import { describe, expect, it } from "vitest";
import { candidateCommand, candidateId, candidateReceipt, type CandidateRow } from "../../src/venues/venue-photo-candidates";
import { venueCandidateDecision } from "../../src/admin/venues.dto";

describe("candidate command boundaries", () => {
  it("requires exact matching withdrawal CAS representations before a mutation", () => {
    expect(candidateCommand("1", {expectedVersion:1})).toBe(1);
    for (const body of [null,[],1,{}, {expectedVersion:"1"}, {expectedVersion:2}, {expectedVersion:1,extra:true}]) {
      expect(()=>candidateCommand("1",body)).toThrow();
    }
    expect(()=>candidateCommand(undefined,{expectedVersion:1})).toThrow();
    expect(()=>candidateCommand("2",{expectedVersion:1})).toThrow();
  });
  it("bounds privileged decision versions and rejects unknown decision fields", () => {
    expect(venueCandidateDecision.safeParse({action:"accept",expectedVersion:3,expectedCandidateVersion:1}).success).toBe(true);
    for(const body of [{action:"accept",expectedVersion:0,expectedCandidateVersion:1},
      {action:"accept",expectedVersion:3,expectedCandidateVersion:2},
      {action:"accept",expectedVersion:3,expectedCandidateVersion:1,setMain:true}]) {
      expect(venueCandidateDecision.safeParse(body).success).toBe(false);
    }
    expect(()=>candidateId("not-a-uuid")).toThrow();
  });
  it("never exposes storage/approval/hash or a preview after a terminal decision", () => {
    const row={id:"id",venue_id:"venue",status:"accepted",version:2,width:1200,height:400,
      storage_key:"private",image_approval_id:"approval",image_sha256:"hash",evidence:{}} as CandidateRow;
    const receipt=candidateReceipt(row);
    expect(receipt.previewPath).toBeNull();
    expect(receipt).not.toHaveProperty("storage_key");expect(receipt).not.toHaveProperty("image_sha256");
    expect(receipt).not.toHaveProperty("image_approval_id");
  });
});
