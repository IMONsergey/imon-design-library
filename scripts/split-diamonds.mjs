// Deterministic, non-executing adaptation of the owner's reviewed source.
// --patch emits an apply_patch document for a NEW version; it never writes files.
// --check compares the committed standalone assets with this derivation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const ORIGINAL_SHA256 = '59ceac923be98dd8cf158fab14b9b221f61fea045f75463eaddb0ffcc89ea402';
export const VERSION = '1.1.0';
export const PACK_DIRECTORY = `packs/visual-weblg/${VERSION}`;
const root = fileURLToPath(new URL('../', import.meta.url));
const originalPath = path.join(root, 'packs/visual-weblg/1.0.0/diamond-cut-study-restored.html');
export const CUTS = Object.freeze([
  { id: 'round', title: 'Круглая', description: 'Круглая бриллиантовая огранка' },
  { id: 'oval', title: 'Овал', description: 'Овальная бриллиантовая огранка' },
  { id: 'pear', title: 'Груша', description: 'Грушевидная бриллиантовая огранка' },
  { id: 'marquise', title: 'Маркиз', description: 'Бриллиантовая огранка маркиз' },
  { id: 'cushion', title: 'Кушон', description: 'Бриллиантовая огранка кушон' },
  { id: 'princess', title: 'Принцесса', description: 'Бриллиантовая огранка принцесса' },
  { id: 'emerald', title: 'Изумруд', description: 'Изумрудная ступенчатая огранка' },
  { id: 'radiant', title: 'Радиант', description: 'Бриллиантовая огранка радиант' },
  { id: 'asscher', title: 'Ашер', description: 'Ступенчатая огранка ашер' },
  { id: 'trillion', title: 'Триллион', description: 'Треугольная бриллиантовая огранка' },
]);

function extract(source, first, next) {
  const start = source.indexOf(first), end = source.indexOf(next, start + first.length);
  if (start < 0 || end < 0 || source.indexOf(first, start + first.length) >= 0) throw new Error(`Ambiguous original source boundary: ${first}`);
  return source.slice(start, end);
}

export function reviewedSections(source = fs.readFileSync(originalPath, 'utf8')) {
  if (createHash('sha256').update(source).digest('hex') !== ORIGINAL_SHA256) throw new Error('The preserved original source has changed; do not silently regenerate');
  return {
    shaders: extract(source, 'const VS=', 'function compile(type,source)'),
    geometry: extract(source, 'const TAU=', 'const models={};'),
    drawing: extract(source, 'function updateRotation(){', 'function adapt(dt){'),
  };
}

const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// This shell replaces the original cut picker and fixed 520px minimum only.
// The studio shaders, cut geometry, normalization, projection and draw bounds
// below are copied verbatim from the supplied asset, not recreated.
export function renderDiamond(cut, sections = reviewedSections()) {
  if (!CUTS.some(item => item.id === cut.id && item.title === cut.title)) throw new Error('Unknown diamond cut');
  const rootId = `imon-diamond-${cut.id}`, name = escapeHtml(cut.title), description = escapeHtml(cut.description);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${name} · Diamonds Collection</title>
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff}
#${rootId}{position:relative;width:100%;height:100%;min-height:0;overflow:hidden;background:#fff;isolation:isolate;font-family:system-ui,-apple-system,sans-serif;-webkit-user-select:none;user-select:none;color-scheme:light}
#${rootId},#${rootId} *{box-sizing:border-box}
#${rootId} .dc5-stage{position:absolute;inset:0;background:#fff}
#${rootId} canvas{position:absolute;inset:0;display:block;width:100%;height:100%;cursor:grab;touch-action:none}
#${rootId} canvas:active{cursor:grabbing}
#${rootId} canvas:focus-visible{outline:2px solid #8b99a6;outline-offset:-3px}
#${rootId} .dc5-head{position:absolute;top:18px;left:20px;right:20px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;pointer-events:none}
#${rootId} .dc5-name{margin:5px 0 0;font-size:12px;font-weight:400;line-height:1.5;color:#8191a0}
#${rootId} .dc5-views{display:flex;gap:3px;padding:3px;border:1px solid #eaf0f5;border-radius:8px;background:rgba(255,255,255,.88);pointer-events:auto}
#${rootId} .dc5-view{appearance:none;border:0;border-radius:5px;background:transparent;color:#7c8c9b;padding:7px 10px;font:500 11px/1.4 system-ui;cursor:pointer;transition:background .2s,color .2s}
#${rootId} .dc5-view.active{color:#415c74;background:#eef4f8}
#${rootId} .dc5-view:hover{color:#415c74;background:#f2f6f9}
#${rootId} .dc5-view:focus-visible{outline:2px solid #8b99a6;outline-offset:1px}
#${rootId} .dc5-view svg{display:block;width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
#${rootId} .dc5-hint{position:absolute;left:50%;bottom:14px;margin:0;transform:translateX(-50%);white-space:nowrap;color:#a3afba;font-size:11px;line-height:1.5;pointer-events:none}
#${rootId} .dc5-error{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:#fff;color:#64717f;text-align:center;font-size:13px;line-height:1.5}
#${rootId} [hidden]{display:none!important}
@media(max-height:360px),(max-width:560px) and (max-height:440px){#${rootId} .dc5-head,#${rootId} .dc5-hint{display:none}}
@media(prefers-reduced-motion:reduce){#${rootId} .dc5-view{transition:none}}
</style>
</head>
<body>
<main id="${rootId}" class="dc5" data-cut="${cut.id}" aria-label="${description}">
<div class="dc5-stage">
<canvas width="480" height="360" tabindex="0" aria-label="${description}. Перетаскивай для вращения. Стрелки меняют ракурс, Home сбрасывает положение." aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home"></canvas>
<div class="dc5-head">
<p class="dc5-name">${name}</p>
<div class="dc5-views" role="group" aria-label="Ракурс">
<button type="button" class="dc5-view active" data-view="three" aria-label="Ракурс 3/4" aria-pressed="true">3/4</button>
<button type="button" class="dc5-view" data-view="top" aria-label="Вид сверху" aria-pressed="false">Сверху</button>
<button type="button" class="dc5-view" data-view="reset" aria-label="Сбросить положение"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.8 5.7A5 5 0 1 0 13 9M13 2v4H9"/></svg></button>
</div>
</div>
<p class="dc5-hint">Потяни, чтобы вращать</p>
</div>
<div class="dc5-error" role="status" hidden>WebGL недоступен. Попробуй браузер с аппаратным ускорением.</div>
<noscript><div class="dc5-error">Для интерактивного превью нужен JavaScript.</div></noscript>
<script>
(()=>{
"use strict";
const root=document.getElementById(${JSON.stringify(rootId)});
if(!root||root.dataset.ready)return;
root.dataset.ready="1";
const CUT_ID=${JSON.stringify(cut.id)};
const stage=root.querySelector(".dc5-stage"),canvas=root.querySelector("canvas"),errorBox=root.querySelector(".dc5-error");
let gl;
try{gl=canvas.getContext("webgl",{alpha:false,antialias:true,preserveDrawingBuffer:true,powerPreference:"high-performance"})}catch(_){gl=null}
if(!gl){root.dataset.status="unavailable";errorBox.hidden=false;return}

${sections.shaders}${sections.geometry}
let bgProgram,gemProgram,buffer,bgRes,gemRes,gemRot,gemPlanes,gemCount,gemRadius,gemAlpha;
let gpuShaders=[],gpuPrograms=[];
let width=1,height=1,tier=0,compact=true;
const quality=[1,.86,.74],gem=model(CUT_ID);
let yaw=0,pitch=.92,targetYaw=0,targetPitch=.92,view="three";
let dragging=false,lastX=0,lastY=0,lastInteraction=performance.now();
let lastMoveTime=0,velocityYaw=0,velocityPitch=0,inertiaYaw=0,inertiaPitch=0;
let lastTime=0,lastDrawTime=0,dirty=true,visible=true,slow=0,fast=0;
let rafId=0,wakeId=0,destroyed=false,contextLost=false;
let resizeObserver,intersectionObserver,removalObserver;
const media=window.matchMedia("(prefers-reduced-motion: reduce)");
let reduced=media.matches;
const dragYaw=.0038,dragPitch=.0031,inertiaFriction=3.5;
const orbitSpeed=.085,orbitDelay=2000;
let orbitWeight=0;
const matrix=new Float32Array(9),events=new AbortController();
const listen=(target,name,handler,options={})=>target.addEventListener(name,handler,{...options,signal:events.signal});

function releaseGpu(){
if(buffer)gl.deleteBuffer(buffer);
for(const p of gpuPrograms)gl.deleteProgram(p);
for(const s of gpuShaders)gl.deleteShader(s);
buffer=null;gpuPrograms=[];gpuShaders=[];
}
function compile(type,source){
const s=gl.createShader(type);if(!s)throw Error("Shader allocation failed");
gpuShaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);
if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error("Shader compilation failed");
return s;
}
function program(fs,v){
const p=gl.createProgram();if(!p)throw Error("Program allocation failed");
gpuPrograms.push(p);gl.attachShader(p,v);gl.attachShader(p,compile(gl.FRAGMENT_SHADER,fs));
gl.bindAttribLocation(p,0,"a");gl.linkProgram(p);
if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error("Program linking failed");
return p;
}
function initializeGpu(){
releaseGpu();
const v=compile(gl.VERTEX_SHADER,VS);
bgProgram=program(BG,v);gemProgram=program(FS,v);
buffer=gl.createBuffer();if(!buffer)throw Error("Buffer allocation failed");
gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
bgRes=gl.getUniformLocation(bgProgram,"res");gemRes=gl.getUniformLocation(gemProgram,"res");
gemRot=gl.getUniformLocation(gemProgram,"rot");gemPlanes=gl.getUniformLocation(gemProgram,"planes[0]");
gemCount=gl.getUniformLocation(gemProgram,"count");gemRadius=gl.getUniformLocation(gemProgram,"radius");gemAlpha=gl.getUniformLocation(gemProgram,"alpha");
errorBox.hidden=true;root.dataset.status="initializing";
}
function stop(){
if(rafId)cancelAnimationFrame(rafId);
if(wakeId)clearTimeout(wakeId);
rafId=0;wakeId=0;lastTime=0;lastDrawTime=0;orbitWeight=0;
}
function destroy(){
if(destroyed)return;destroyed=true;stop();events.abort();
resizeObserver?.disconnect();intersectionObserver?.disconnect();removalObserver?.disconnect();
if(!contextLost){releaseGpu();gl.getExtension("WEBGL_lose_context")?.loseContext()}
root.dataset.status="stopped";
}
function schedule(){
if(destroyed||contextLost||document.hidden||!visible)return;
if(!root.isConnected){destroy();return}
if(!rafId)rafId=requestAnimationFrame(frame);
}
function wake(){
if(wakeId){clearTimeout(wakeId);wakeId=0}
dirty=true;schedule();
}
function unavailable(message){
stop();errorBox.textContent=message;errorBox.hidden=false;root.dataset.status="unavailable";
}
function resize(){
if(destroyed)return;
const w=stage.clientWidth,h=stage.clientHeight;
if(!w||!h){stop();return}
compact=h<=360||(w<=560&&h<=440);
const ratio=compact?Math.min(window.devicePixelRatio||1,1,480/Math.max(w,h)):Math.min(window.devicePixelRatio||1,w<600?.9:1.05)*quality[tier];
width=Math.max(1,Math.round(w*ratio));height=Math.max(1,Math.round(h*ratio));
const resized=canvas.width!==width||canvas.height!==height;
if(canvas.width!==width)canvas.width=width;
if(canvas.height!==height)canvas.height=height;
if(!contextLost){
gl.viewport(0,0,width,height);
if(resized||root.dataset.status==="initializing"){
root.dataset.status="pending";
gl.disable(gl.SCISSOR_TEST);gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT);
}
}
root.dataset.quality=compact?"card":"full";wake();
}
function setCamera(mode){
if(mode!=="reset")view=mode;
targetYaw=0;targetPitch=view==="top"?Math.PI/2:.92;
inertiaYaw=0;inertiaPitch=0;velocityYaw=0;velocityPitch=0;orbitWeight=0;
lastInteraction=performance.now();
for(const b of root.querySelectorAll(".dc5-view")){
const selected=b.dataset.view===view;b.classList.toggle("active",selected);
if(b.dataset.view!=="reset")b.setAttribute("aria-pressed",String(selected));
}
wake();
}
${sections.drawing}
function adapt(dt){
if(compact)return;
if(dt>29){slow++;fast=0}else{slow=Math.max(0,slow-1);fast=dt<20?fast+1:0}
if(slow>75&&tier<2){tier++;slow=0;fast=0;resize()}
else if(fast>480&&tier>0){tier--;slow=0;fast=0;resize()}
}
function frame(t){
rafId=0;
if(destroyed||contextLost)return;
if(!root.isConnected){destroy();return}
if(!visible||document.hidden){stop();return}
if(lastDrawTime&&t-lastDrawTime<(compact?1000/30:1000/60)-1){schedule();return}
const dt=lastTime?Math.min(100,t-lastTime):16;lastTime=t;lastDrawTime=t;
adapt(dt);
const seconds=dt*.001;
if(!dragging){
const friction=Math.exp(-inertiaFriction*seconds),travel=(1-friction)/inertiaFriction;
if(Math.abs(inertiaYaw)>.0003||Math.abs(inertiaPitch)>.0003){
targetYaw+=inertiaYaw*travel;targetPitch+=inertiaPitch*travel;inertiaYaw*=friction;inertiaPitch*=friction;dirty=true;
}
}
const orbitReady=!reduced&&!dragging&&t-lastInteraction>orbitDelay&&Math.abs(inertiaYaw)<.015&&Math.abs(inertiaPitch)<.015;
orbitWeight+=((orbitReady?1:0)-orbitWeight)*(1-Math.exp(-seconds*(orbitReady?1.2:6)));
if(orbitWeight>.0001){targetYaw+=orbitSpeed*orbitWeight*seconds;dirty=true}
const ease=1-Math.exp(-seconds*(dragging?27:12));
yaw+=(targetYaw-yaw)*ease;pitch+=(targetPitch-pitch)*ease;
const moving=Math.abs(yaw-targetYaw)>.0003||Math.abs(pitch-targetPitch)>.0003;
if(dirty||moving){
dirty=false;updateRotation();
gl.disable(gl.SCISSOR_TEST);gl.disable(gl.BLEND);
gl.useProgram(bgProgram);gl.uniform2f(bgRes,width,height);gl.drawArrays(gl.TRIANGLES,0,6);
gl.useProgram(gemProgram);gl.uniform2f(gemRes,width,height);gl.uniformMatrix3fv(gemRot,false,matrix);
gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);draw(gem,1);gl.disable(gl.BLEND);
if(root.dataset.status!=="ready")root.dataset.status="ready";
}
if(moving||dirty||Math.abs(inertiaYaw)>.0003||Math.abs(inertiaPitch)>.0003||orbitReady||orbitWeight>.0001)schedule();
else if(!reduced&&!dragging){
lastTime=0;
wakeId=setTimeout(()=>{wakeId=0;schedule()},Math.max(16,orbitDelay-(performance.now()-lastInteraction)+16));
}
}

listen(root.querySelector(".dc5-views"),"click",e=>{const b=e.target.closest("button[data-view]");if(b)setCamera(b.dataset.view)});
listen(canvas,"pointerdown",e=>{
e.preventDefault();dragging=true;lastX=e.clientX;lastY=e.clientY;lastInteraction=performance.now();
orbitWeight=0;targetYaw=yaw;targetPitch=pitch;
velocityYaw=0;velocityPitch=0;inertiaYaw=0;inertiaPitch=0;lastMoveTime=lastInteraction;
try{canvas.setPointerCapture(e.pointerId)}catch(_){}
wake();
});
listen(canvas,"pointermove",e=>{
if(!dragging)return;
const now=performance.now(),dx=e.clientX-lastX,dy=e.clientY-lastY;
const elapsed=Math.max(8,Math.min(64,now-lastMoveTime)),blend=1-Math.exp(-elapsed/42);
velocityYaw+=(Math.max(-3.2,Math.min(3.2,dx*dragYaw*1000/elapsed))-velocityYaw)*blend;
velocityPitch+=(Math.max(-2.7,Math.min(2.7,dy*dragPitch*1000/elapsed))-velocityPitch)*blend;
targetYaw+=dx*dragYaw;targetPitch+=dy*dragPitch;
lastX=e.clientX;lastY=e.clientY;lastInteraction=now;lastMoveTime=now;wake();
});
const release=e=>{
if(!dragging)return;dragging=false;
const now=performance.now(),freshness=Math.exp(-Math.max(0,now-lastMoveTime-45)/110);
inertiaYaw=e?.type==="pointercancel"||reduced?0:velocityYaw*freshness;
inertiaPitch=e?.type==="pointercancel"||reduced?0:velocityPitch*freshness;
lastInteraction=now;wake();
};
listen(canvas,"pointerup",release);listen(canvas,"pointercancel",release);listen(canvas,"lostpointercapture",release);
listen(canvas,"keydown",e=>{
const directions={ArrowLeft:[-.12,0],ArrowRight:[.12,0],ArrowUp:[0,-.10],ArrowDown:[0,.10]};
if(e.key==="Home"){e.preventDefault();setCamera("reset");return}
const direction=directions[e.key];if(!direction)return;
e.preventDefault();targetYaw+=direction[0];targetPitch+=direction[1];
inertiaYaw=0;inertiaPitch=0;orbitWeight=0;lastInteraction=performance.now();wake();
});
listen(canvas,"webglcontextlost",e=>{
e.preventDefault();contextLost=true;stop();dragging=false;
gpuShaders=[];gpuPrograms=[];buffer=null;
errorBox.textContent="Контекст WebGL потерян. Ожидаем восстановления.";errorBox.hidden=false;root.dataset.status="context-lost";
});
listen(canvas,"webglcontextrestored",()=>{
if(destroyed)return;contextLost=false;lastInteraction=performance.now();
try{initializeGpu();resize()}catch(_){unavailable("Не удалось восстановить WebGL. Обнови страницу.")}
});
listen(document,"visibilitychange",()=>{if(document.hidden){dragging=false;stop()}else wake()});
listen(media,"change",e=>{reduced=e.matches;inertiaYaw=0;inertiaPitch=0;orbitWeight=0;lastInteraction=performance.now();root.dataset.motion=reduced?"reduced":"auto";wake()});
listen(window,"pagehide",e=>{if(e.persisted)stop();else destroy()});
listen(window,"pageshow",e=>{if(e.persisted)wake()});
try{initializeGpu()}catch(_){releaseGpu();unavailable("WebGL недоступен. Попробуй браузер с аппаратным ускорением.");events.abort();return}
root.dataset.motion=reduced?"reduced":"auto";
if(window.ResizeObserver){resizeObserver=new ResizeObserver(resize);resizeObserver.observe(stage)}else listen(window,"resize",resize);
if(window.IntersectionObserver){
intersectionObserver=new IntersectionObserver(entries=>{visible=!!entries[0]?.isIntersecting;if(visible)wake();else stop()},{threshold:.01});intersectionObserver.observe(root);
}
removalObserver=new MutationObserver(()=>{if(!root.isConnected)destroy()});
removalObserver.observe(document.documentElement,{childList:true,subtree:true});
resize();
})();
</script>
</main>
</body>
</html>
`;
}

export function renderAllDiamonds(source) {
  const sections = reviewedSections(source);
  return new Map(CUTS.map(cut => [`${PACK_DIRECTORY}/assets/${cut.id}.html`, renderDiamond(cut, sections)]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (!['--patch', '--check'].includes(mode) || process.argv.length !== 3) throw new Error('Usage: node scripts/split-diamonds.mjs --patch|--check');
  const files = renderAllDiamonds();
  if (mode === '--check') {
    for (const [filename, content] of files) if (fs.readFileSync(path.join(root, filename), 'utf8') !== content) throw new Error(`Derived asset drifted: ${filename}`);
    console.log(`Verified ${files.size} standalone diamond assets against the unchanged original.`);
  } else {
    for (const filename of files.keys()) if (fs.existsSync(path.join(root, filename))) throw new Error(`Refusing to overwrite existing asset: ${filename}`);
    const edits = [...files].map(([filename, content]) => `*** Add File: ${path.join(root, filename)}\n${content.trimEnd().split('\n').map(line => `+${line}`).join('\n')}`).join('\n');
    process.stdout.write(`*** Begin Patch\n${edits}\n*** End Patch\n`);
  }
}
