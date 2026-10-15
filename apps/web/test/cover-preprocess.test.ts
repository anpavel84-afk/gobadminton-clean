import { afterEach, describe, expect, it, vi } from "vitest";
import { preprocessAvatar } from "../src/lib/avatar-preprocess";
function jpeg(w=800,h=600,orientation=1) {
  return new Uint8Array([255,216,255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,orientation,0,0,0,0,0,0,0,255,192,0,8,8,h>>8,h&255,w>>8,w&255,3,255,217]);
}
afterEach(()=>vi.unstubAllGlobals());
describe("confirmed cover crop uses existing bounded image preprocessor",()=>{
  for(const orientation of [1,2,3,4,5,6,7,8])it(`orients ${orientation} before framing and strips output metadata`,async()=>{
    const close=vi.fn(),draw=vi.fn(),transform=vi.fn();
    vi.stubGlobal("createImageBitmap",vi.fn().mockResolvedValue({width:800,height:600,close}));
    const oriented={width:0,height:0,getContext:()=>({setTransform:transform,drawImage:vi.fn()})};
    const output={width:0,height:0,getContext:()=>({fillRect:vi.fn(),drawImage:draw}),toBlob:(cb:(b:Blob)=>void,mime:string)=>cb(new Blob([jpeg(1200,400)],{type:mime==="image/webp"?"image/png":"image/jpeg"}))};
    let n=0;vi.stubGlobal("document",{createElement:()=>n++===0?output:oriented});
    const result=await preprocessAvatar(new File([jpeg(800,600,orientation)],"source.jpg",{type:"image/jpeg"}),undefined,{x:.5,y:1});
    expect(result.type).toBe("image/jpeg");expect(new TextDecoder().decode(await result.arrayBuffer())).not.toContain("Exif");
    expect(transform).toHaveBeenCalledOnce();expect(draw).toHaveBeenCalledOnce();
    const args=draw.mock.calls[0]!;const w=orientation>=5?600:800,h=orientation>=5?800:600;
    expect(args.slice(1)).toEqual([0,h-w/3,w,w/3,0,0,1200,400]);
    expect(close).toHaveBeenCalledOnce();expect(output.width).toBe(0);expect(oriented.width).toBe(0);
  });
  it("rejects an oversized source before invoking any browser decoder",async()=>{
    const decode=vi.fn();vi.stubGlobal("createImageBitmap",decode);
    await expect(preprocessAvatar(new File([new Uint8Array(10*1024*1024+1)],"oversized.jpg"),undefined,{x:0,y:0})).rejects.toThrow("10 МБ");
    expect(decode).not.toHaveBeenCalled();
  });
});
