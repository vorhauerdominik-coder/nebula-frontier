/* Nebula Engine 1.0 – dependency-free browser runtime */
(function(global){
 'use strict';
 class GameClock {
  constructor({maxDelta=50}={}){this.maxDelta=maxDelta;this.last=null;this.deltaMs=16.667;this.elapsedMs=0;this.frames=0;}
  tick(now){if(this.last===null){this.last=now;return this.deltaMs;}this.deltaMs=Math.max(0,Math.min(this.maxDelta,now-this.last));this.last=now;this.elapsedMs+=this.deltaMs;this.frames++;return this.deltaMs;}
  reset(){this.last=null;}
 }
 class SnapshotInterpolator {
  constructor({delayMs=95,maxExtrapolationMs=100,historySize=5}={}){this.delayMs=delayMs;this.maxExtrapolationMs=maxExtrapolationMs;this.historySize=historySize;this.entities=new Map();}
  update(list,now){const present=new Set();for(const e of list){const id=e.id??e.username;if(id==null||!Number.isFinite(e.x)||!Number.isFinite(e.y))continue;present.add(id);let h=this.entities.get(id);if(!h){h=[];this.entities.set(id,h);}const previous=h[h.length-1];if(previous&&Math.hypot(e.x-previous.x,e.y-previous.y)>850)h.length=0;h.push({x:e.x,y:e.y,t:now});if(h.length>this.historySize)h.shift();}for(const id of this.entities.keys())if(!present.has(id))this.entities.delete(id);}
  position(e,now){const h=this.entities.get(e.id??e.username);if(!h?.length)return e;const target=now-this.delayMs;let a=h[0],b=h[h.length-1];for(let i=1;i<h.length;i++){if(h[i].t>=target){a=h[i-1];b=h[i];break;}a=h[i];}let x,y;if(target<=a.t||a===b){x=a.x;y=a.y;}else if(target<=b.t){const alpha=Math.min(1,(target-a.t)/Math.max(1,b.t-a.t));x=a.x+(b.x-a.x)*alpha;y=a.y+(b.y-a.y)*alpha;}else{const prior=h[h.length-2];if(prior){const dt=Math.max(1,b.t-prior.t),extra=Math.min(this.maxExtrapolationMs,target-b.t);x=b.x+(b.x-prior.x)/dt*extra;y=b.y+(b.y-prior.y)/dt*extra;}else{x=b.x;y=b.y;}}return {...e,x,y};}
  clear(){this.entities.clear();}
 }
 class Camera2D {
  constructor(x=1200,y=850){this.x=x;this.y=y;}
  follow(x,y,dtMs,halfLifeMs=85){const a=1-Math.pow(.5,dtMs/halfLifeMs);this.x+=(x-this.x)*a;this.y+=(y-this.y)*a;}
  snap(x,y){this.x=x;this.y=y;}
 }
 class ParticlePool {
  constructor(max=250){this.max=max;this.items=[];}
  emit(x,y,color='#7ceaff',count=8){for(let i=0;i<count;i++){if(this.items.length>=this.max)this.items.shift();const a=Math.random()*Math.PI*2,s=35+Math.random()*125;this.items.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.25+Math.random()*.5,maxLife:.75,color});}}
  update(dtMs){const dt=dtMs/1000;for(const p of this.items){p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;}this.items=this.items.filter(p=>p.life>0);}
  draw(ctx,worldToScreen){for(const p of this.items){const s=worldToScreen(p.x,p.y);ctx.globalAlpha=Math.min(1,p.life/p.maxLife);ctx.fillStyle=p.color;ctx.fillRect(s.x,s.y,2.5,2.5);}ctx.globalAlpha=1;}
 }
 global.NebulaEngine=Object.freeze({version:'1.0.0',GameClock,SnapshotInterpolator,Camera2D,ParticlePool});
})(window);
