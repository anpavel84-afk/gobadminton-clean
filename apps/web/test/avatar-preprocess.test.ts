import { afterEach, describe, expect, it, vi } from 'vitest';
import { avatarAbortable, inspectAvatarSource, preprocessAvatar, stripAvatarMetadata } from '../src/lib/avatar-preprocess';
function png(w: number, h: number, animated = false) {
  const a = new Uint8Array(animated ? 57 : 45), v = new DataView(a.buffer);
  a.set([137,80,78,71,13,10,26,10]); v.setUint32(8,13); a.set([...('IHDR')].map(x=>x.charCodeAt(0)),12); v.setUint32(16,w); v.setUint32(20,h);
  let p=33;if(animated){a.set([...('acTL')].map(x=>x.charCodeAt(0)),p+4);p+=12;}a.set([...('IEND')].map(x=>x.charCodeAt(0)),p+4);return a;
}
function jpeg(w=512,h=512,orientation=1) {
  return new Uint8Array([255,216,255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,orientation,0,0,0,0,0,0,0,255,192,0,8,8,h>>8,h&255,w>>8,w&255,3,255,217]);
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('bounded avatar source inspection',()=>{
  it('strips JPEG EXIF and WebP ICC/EXIF/XMP chunks and repairs RIFF feature flags/length',async()=>{
    const stripped=stripAvatarMetadata(jpeg(512,512,6).buffer,'image/jpeg');
    expect(inspectAvatarSource(await stripped.arrayBuffer())).toMatchObject({orientation:1,width:512,height:512});
    const a=new Uint8Array(42),v=new DataView(a.buffer);a.set(new TextEncoder().encode('RIFF'));v.setUint32(4,34,true);a.set(new TextEncoder().encode('WEBPVP8X'),8);v.setUint32(16,10,true);a[20]=0x2c;a[24]=255;a[25]=1;a[27]=255;a[28]=1;a.set(new TextEncoder().encode('ICCP'),30);v.setUint32(34,4,true);a.set([1,2,3,4],38);
    const out=new Uint8Array(await stripAvatarMetadata(a.buffer,'image/webp').arrayBuffer());expect(out.length).toBe(30);expect(new DataView(out.buffer).getUint32(4,true)).toBe(22);expect(out[20]).toBe(0);expect(new TextDecoder().decode(out)).not.toContain('ICCP');
  });
  it('accepts inclusive 50 MP and orientation but rejects larger decoded raster before decode',()=>{
    expect(inspectAvatarSource(png(10000,5000).buffer)).toMatchObject({width:10000,height:5000,mime:'image/png'});
    expect(()=>inspectAvatarSource(png(10000,5001).buffer)).toThrow('50 Мп');
    for(let orientation=1;orientation<=8;orientation++)expect(inspectAvatarSource(jpeg(800,600,orientation).buffer).orientation).toBe(orientation);
  });
  it('rejects MIME disagreement, HEIC, SVG, corrupt/truncated chunks and APNG',()=>{
    expect(()=>inspectAvatarSource(png(512,512).buffer,'image/jpeg')).toThrow();
    for(const text of ['....ftypheic','<svg/>','not an image'])expect(()=>inspectAvatarSource(new TextEncoder().encode(text).buffer)).toThrow();
    expect(()=>inspectAvatarSource(png(512,512).slice(0,24).buffer)).toThrow();
    expect(()=>inspectAvatarSource(png(512,512,true).buffer)).toThrow('без анимации');
    const corrupt=png(1,1);new DataView(corrupt.buffer).setUint32(8,0xffffffff);expect(()=>inspectAvatarSource(corrupt.buffer)).toThrow();
  });
  it('reads WebP VP8X dimensions and rejects animation flag/chunks',()=>{
    const a=new Uint8Array(30),v=new DataView(a.buffer);a.set(new TextEncoder().encode('RIFF'));v.setUint32(4,22,true);a.set(new TextEncoder().encode('WEBPVP8X'),8);v.setUint32(16,10,true);a[24]=255;a[25]=1;a[27]=255;a[28]=1;
    expect(inspectAvatarSource(a.buffer)).toMatchObject({width:512,height:512,mime:'image/webp'});a[20]=2;expect(()=>inspectAvatarSource(a.buffer)).toThrow('без анимации');
  });
  it('settles abort and closes decoder that completes after abort',async()=>{
    let resolve!: (x: {close:()=>void})=>void;const late=new Promise<{close:()=>void}>(r=>resolve=r);const c=new AbortController();const close=vi.fn();const waiting=avatarAbortable(late,c.signal,x=>x.close());c.abort();await expect(waiting).rejects.toThrow();resolve({close});await Promise.resolve();expect(close).toHaveBeenCalledOnce();
  });
  it('source byte ceiling includes exactly 10 MiB; overlimit never invokes decoder',async()=>{
    const decode=vi.fn().mockRejectedValue(new Error('decode'));vi.stubGlobal('createImageBitmap',decode);vi.stubGlobal('Image',class {removeAttribute() {} set src(_:string){throw new Error('decoder fallback');}});
    const body=new Uint8Array(10*1024*1024);body.set(jpeg());
    await expect(preprocessAvatar(new File([body],'boundary.jpg',{type:'image/jpeg'}))).rejects.toThrow('Не удалось подготовить');expect(decode).toHaveBeenCalledOnce();decode.mockClear();
    await expect(preprocessAvatar(new File([body,new Uint8Array(1)],'large.jpg'))).rejects.toThrow('10 МБ');expect(decode).not.toHaveBeenCalled();
  });
  it('JPEG fallback, center crop, release and bounded encoder failure',async()=>{
    const close=vi.fn(),draw=vi.fn();vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValue({width:800,height:600,close}));
    const calls:string[]=[];const canvas={width:0,height:0,getContext:()=>({fillRect:vi.fn(),drawImage:draw}),toBlob:(cb:(x:Blob|null)=>void,mime:string)=>{calls.push(mime);cb(new Blob([mime==='image/webp'?png(512,512):jpeg()],{type:mime==='image/webp'?'image/png':mime}));}};
    vi.stubGlobal('document',{createElement:()=>canvas});const result=await preprocessAvatar(new File([jpeg(800,600)],'camera.jpg',{type:'image/jpeg'}));expect(result.type).toBe('image/jpeg');expect(calls).toEqual(['image/webp','image/jpeg']);expect(draw.mock.calls[0]?.slice(1)).toEqual([100,0,600,600,0,0,512,512]);expect(close).toHaveBeenCalledOnce();expect(canvas.width).toBe(0);
    canvas.toBlob=cb=>cb(null);await expect(preprocessAvatar(new File([jpeg()],'x.jpg'))).rejects.toThrow('уменьшить');
  });
  it('hanging bitmap decode times out; next operation succeeds',async()=>{
    vi.useFakeTimers();const decode=vi.fn().mockReturnValue(new Promise(()=>{}));vi.stubGlobal('createImageBitmap',decode);
    const result=preprocessAvatar(new File([jpeg()],'x.jpg'));const rejection=expect(result).rejects.toThrow('слишком долго');await vi.advanceTimersByTimeAsync(12000);await rejection;
    decode.mockResolvedValue({width:512,height:512,close:vi.fn()});vi.stubGlobal('document',{createElement:()=>({getContext:()=>({fillRect:vi.fn(),drawImage:vi.fn()}),toBlob:(cb:(b:Blob)=>void)=>cb(new Blob([jpeg()],{type:'image/jpeg'}))})});
    expect((await preprocessAvatar(new File([jpeg()],'x.jpg'))).type).toBe('image/jpeg');
  });
  it('reduces quality within a finite budget and fails oversized output; hanging encoder times out',async()=>{
    vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValue({width:512,height:512,close:vi.fn()}));
    const huge=new Uint8Array(524400);huge.set(jpeg());
    const qualities:number[]=[];
    const canvas={getContext:()=>({fillRect:vi.fn(),drawImage:vi.fn()}),toBlob:(cb:(b:Blob|null)=>void,mime:string,quality:number)=>{qualities.push(quality);cb(mime==='image/webp'?null:new Blob([huge],{type:'image/jpeg'}));}};
    vi.stubGlobal('document',{createElement:()=>canvas});
    await expect(preprocessAvatar(new File([jpeg()],'x.jpg'))).rejects.toThrow('уменьшить');
    expect(qualities).toEqual([0.9,0.9,0.8,0.65,0.5,0.35]);
    vi.useFakeTimers();canvas.toBlob=()=>{};
    const timed=preprocessAvatar(new File([jpeg()],'x.jpg'));const rejection=expect(timed).rejects.toThrow('слишком долго');await vi.advanceTimersByTimeAsync(12000);await rejection;
  });
});
