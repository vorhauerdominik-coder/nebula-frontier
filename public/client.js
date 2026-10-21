(() => {
const canvas=document.getElementById("space"),ctx=canvas.getContext("2d"),mini=document.getElementById("minimap"),mctx=mini.getContext("2d");
let W=innerWidth,H=innerHeight,dpr=1;function resize(){dpr=Math.min(devicePixelRatio||1,2);W=innerWidth;H=innerHeight;canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0)}addEventListener("resize",resize);resize();
let ws=null,authenticated=false,registerMode=false,profile=null,ships={},maps={},remote=[],npcs=[],shots=[],boss=null,stars=[],rocks=[],keys={},mouse={x:W/2,y:H/2,down:false},moveTarget=null,attackTarget=null,last=performance.now(),lastSend=0,lastShot=0,weapon="pulse",noticeTimer=0,turbo=0,explosions=[];
for(let i=0;i<220;i++)stars.push({x:Math.random()*4000-2000,y:Math.random()*3000-1500,r:Math.random()*1.5+.3,a:Math.random()*.7+.2});
for(let i=0;i<55;i++)rocks.push({x:Math.random()*2600-1300,y:Math.random()*1800-900,r:10+Math.random()*35,rot:Math.random()*6.28,spin:(Math.random()-.5)*.3});
const send=o=>{if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(o))};
function connect(){const proto=location.protocol==="https:"?"wss:":"ws:";ws=new WebSocket(`${proto}//${location.host}`);ws.onopen=()=>{};ws.onmessage=e=>{let d;try{d=JSON.parse(e.data)}catch{return}handle(d)};ws.onclose=()=>{if(authenticated){notice("Verbindung getrennt. Seite neu laden, um erneut zu verbinden.");}else msg("Serververbindung fehlgeschlagen. Starte den Server mit npm start.");};ws.onerror=()=>{}}
function handle(d){
 if(d.type==="error"){msg(d.text);notice(d.text);return}
 if(d.type==="authenticated"){authenticated=true;profile=d.self;ships=d.ships;maps=d.maps;remote=d.players||[];npcs=d.npcs||[];boss=d.boss;document.getElementById("auth").hidden=true;document.getElementById("lobby").hidden=false;document.getElementById("hud").hidden=true;updateUI();updateLobby();notice("WILLKOMMEN AN BORD");return}
 if(d.type==="state"){if(!profile)return;profile={...profile,...d.self};ships=d.ships||ships;maps=d.maps||maps;remote=(d.players||[]).filter(p=>p.username!==profile.username);const newNpcs=d.npcs||[];
 if(!document.getElementById("hud").hidden){const nextIds=new Set(newNpcs.map(n=>n.id));for(const old of npcs){if(!nextIds.has(old.id)&&old.hp>0)spawnExplosion(old.x,old.y,"#ff9764")}}
 npcs=newNpcs;shots=d.projectiles||[];boss=d.boss;updateUI();updateLobby();return}
 if(d.type==="profile"){profile={...profile,...d.profile};ships=d.ships||ships;maps=d.maps||maps;updateUI();updateLobby();renderShop();return}
 if(d.type==="mapChanged"){moveTarget=null;attackTarget=null;notice("KARTE GEWECHSELT");return}
 if(d.type==="chat"){addChat(d);return}
 if(d.type==="presence"){remote=(d.players||[]).filter(p=>p.username!==profile?.username);renderOnline();updateLobby();return}
 if(d.type==="notice"){notice(d.text);return}
 if(d.type==="reward"){if(profile){profile.credits=d.credits;profile.xp=d.xp;profile.level=d.level;profile.kills=d.kills;profile.quest=d.quest;updateUI()}return}
}
function updateLobby(){
 if(!profile)return;
 const el=id=>document.getElementById(id);
 el("lobbyPilot").textContent=profile.username||"Pilot";
 el("lobbyFaction").textContent=(profile.faction||"").toUpperCase();
 el("lobbyLevel").textContent=profile.level??1;
 el("lobbyCredits").textContent=Number(profile.credits||0).toLocaleString("de-DE");
 el("lobbyKills").textContent=profile.kills??0;
 el("lobbyXp").textContent=profile.xp??0;
 el("lobbyMap").textContent=maps[profile.map]?.name||profile.map||"Grenzgebiet";
 el("lobbyQuest").textContent=profile.quest?.claimed?"Abgeschlossen":`${profile.quest?.kills||0} / 5 besiegt`;
 el("lobbyOnline").textContent=`${remote.length+1} PILOTEN IM SEKTOR`;
 const pilots=[{username:profile.username,me:true},...remote];
 el("lobbyPilots").replaceChildren(...pilots.map(p=>{const row=document.createElement("div");row.className="lobby-pilot-row";const name=document.createElement("span");name.textContent="✦ "+p.username+(p.me?" (du)":"");const dot=document.createElement("span");dot.textContent="● ONLINE";row.append(name,dot);return row}));
}
function launchGame(){if(!authenticated)return;moveTarget=null;attackTarget=null;document.getElementById("lobby").hidden=true;document.getElementById("hud").hidden=false;notice("SEKTOR BETRETEN")}
document.getElementById("lobbyLaunch").onclick=launchGame;
document.getElementById("lobbyLaunchNav").onclick=launchGame;
document.querySelectorAll("[data-lobby-tab]").forEach(b=>b.onclick=()=>{
 document.querySelectorAll("[data-lobby-tab]").forEach(x=>x.classList.remove("selected"));b.classList.add("selected");
 const tab=b.dataset.lobbyTab;
 if(tab==="hangar"){launchGame();document.getElementById("shop").hidden=false;renderShop()}
 else if(tab==="sector")launchGame();
 else document.querySelector(tab==="profile"?".profile-card":".lobby-hero").scrollIntoView({behavior:"smooth",block:"center"});
});
function msg(t){document.getElementById("authMsg").textContent=t||""}
function notice(t){let n=document.getElementById("notice");n.textContent=t;noticeTimer=2.2}
document.getElementById("loginTab").onclick=()=>setMode(false);document.getElementById("registerTab").onclick=()=>setMode(true);
function setMode(r){registerMode=r;document.getElementById("loginTab").classList.toggle("active",!r);document.getElementById("registerTab").classList.toggle("active",r);document.getElementById("factionLabel").hidden=!r;document.getElementById("authGo").textContent=r?"Account erstellen":"Einloggen";document.getElementById("password").autocomplete=r?"new-password":"current-password";msg("")}
document.getElementById("authGo").onclick=()=>{const username=document.getElementById("username").value.trim(),password=document.getElementById("password").value;if(!ws||ws.readyState!==WebSocket.OPEN)return msg("Noch keine Serververbindung.");send({type:registerMode?"register":"login",username,password,faction:document.getElementById("faction").value});msg("Anfrage wird verarbeitet …")};
document.getElementById("password").addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("authGo").click()});
function updateUI(){if(!profile)return;const ship=ships[profile.ship]||{name:profile.ship,hp:100,shield:80,speed:240,damage:12,color:"#55eaff"};document.getElementById("pilotName").textContent=profile.username;document.getElementById("factionTag").textContent=profile.faction.toUpperCase();document.getElementById("hpText").textContent=Math.ceil(profile.hp);document.getElementById("shieldText").textContent=Math.ceil(profile.shield);document.getElementById("hpBar").style.width=Math.max(0,profile.hp/ship.hp*100)+"%";document.getElementById("shieldBar").style.width=Math.max(0,profile.shield/ship.shield*100)+"%";document.getElementById("xpText").textContent=profile.xp+" XP";document.getElementById("xpBar").style.width=Math.min(100,profile.xp/(profile.level*100)*100)+"%";document.getElementById("level").textContent=profile.level;document.getElementById("credits").textContent=profile.credits;document.getElementById("questText").textContent=profile.quest.claimed?"Quest abgeschlossen":`Zerstöre 5 NPCs · ${profile.quest.kills}/5`;document.getElementById("questBar").style.width=Math.min(100,profile.quest.kills/5*100)+"%";document.getElementById("mapSelect").value=profile.map;document.getElementById("mapInfo").textContent=(maps[profile.map]?.name||profile.map)+" · "+remote.length+" Pilot(en)";renderOnline();renderDroneShop()}
function renderOnline(){let el=document.getElementById("onlineList");if(!profile)return;const all=[{username:profile.username,faction:profile.faction,me:true},...remote];el.innerHTML=all.map(p=>`<div class="op"><span>${escapeHtml(p.username)}${p.me?" (du)":""}</span><span class="dot">${escapeHtml(p.faction||"")}</span></div>`).join("")||"Niemand online"}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function addChat(d){const log=document.getElementById("chatLog"),line=document.createElement("div");line.className="chatline";if(d.channel==="system"){line.innerHTML=`<span class="sys">[SYSTEM] ${escapeHtml(d.text)}</span>`}else line.innerHTML=`<span class="faction">[${escapeHtml(d.faction||"")}]</span> <b>${escapeHtml(d.username||"")}</b>: ${escapeHtml(d.text)}`;log.appendChild(line);while(log.children.length>45)log.firstChild.remove();log.scrollTop=log.scrollHeight}
document.getElementById("chatForm").onsubmit=e=>{e.preventDefault();const input=document.getElementById("chatInput"),text=input.value.trim();if(text)send({type:"chat",text});input.value=""};
document.getElementById("mapSelect").onchange=e=>send({type:"switchMap",map:e.target.value});
document.getElementById("claimQuest").onclick=()=>send({type:"claimQuest"});
document.getElementById("shopOpen").onclick=()=>{document.getElementById("shop").hidden=false;renderShop()};document.getElementById("shopClose").onclick=()=>document.getElementById("shop").hidden=true;
document.querySelectorAll("[data-upgrade]").forEach(b=>b.onclick=()=>send({type:"buyUpgrade",upgrade:b.dataset.upgrade}));
document.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>action(b.dataset.action));
function action(a){if(!profile)return;if(a==="repair"){profile.hp=Math.min((ships[profile.ship]?.hp||100),profile.hp+35);send({type:"save"});notice("REPARATUR-PROTOKOLL");}if(a==="shield"){profile.shield=ships[profile.ship]?.shield||80;notice("SCHILD-IMPULS");send({type:"save"})}if(a==="turbo"){turbo=3;notice("TURBO AKTIV")}}
addEventListener("keydown",e=>{keys[e.code]=true;if(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code))e.preventDefault();if(e.code==="Digit1")action("repair");if(e.code==="Digit2")action("shield");if(e.code==="Digit3")action("turbo");if(e.code==="KeyH"&&authenticated)document.getElementById("shop").hidden=!document.getElementById("shop").hidden});
addEventListener("keyup",e=>keys[e.code]=false);canvas.addEventListener("mousemove",e=>{mouse.x=e.clientX;mouse.y=e.clientY});canvas.addEventListener("contextmenu",e=>e.preventDefault());
canvas.addEventListener("mousedown",e=>{
 if(!authenticated||document.getElementById("hud").hidden)return;
 mouse.x=e.clientX;mouse.y=e.clientY;
 if(e.button===0){moveTarget={x:profile.x+(e.clientX-W/2),y:profile.y+(e.clientY-H/2)}}
 if(e.button===2){mouse.down=true;shoot()}
});
addEventListener("mouseup",e=>{if(e.button===2)mouse.down=false});
canvas.addEventListener("dblclick",e=>{
 if(e.button!==0||!authenticated||document.getElementById("hud").hidden)return;
 e.preventDefault();mouse.x=e.clientX;mouse.y=e.clientY;
 const wx=profile.x+e.clientX-W/2,wy=profile.y+e.clientY-H/2;
 const targets=[...npcs.map(n=>({...n,targetType:"npc"})),...remote.filter(p=>p.username!==profile.username).map(p=>({...p,targetType:"player"})),...(boss?[{...boss,targetType:"boss"}]:[])];
 let nearest=null,dist=38;
 for(const t of targets){if(!Number.isFinite(t.x)||!Number.isFinite(t.y)||t.hp<=0)continue;const d=Math.hypot(t.x-wx,t.y-wy);if(d<dist){nearest=t;dist=d}}
 if(nearest){attackTarget={type:nearest.targetType,id:nearest.id,username:nearest.username};moveTarget=null;notice("ZIEL ERFASST · ANGRIFF AKTIV");shootAt(nearest)}
 else {attackTarget=null;notice("KEIN ZIEL UNTER MAUSZEIGER")}
});
function trackedTarget(){
 if(!attackTarget)return null;
 const pool=attackTarget.type==="npc"?npcs:attackTarget.type==="boss"?(boss?[boss]:[]):remote;
 return pool.find(t=>attackTarget.type==="player"?t.username===attackTarget.username:t.id===attackTarget.id)||null;
}
function shootAt(t){
 if(!profile||!t||performance.now()-lastShot<230)return;
 lastShot=performance.now();
 send({type:"shoot",angle:Math.atan2(t.y-profile.y,t.x-profile.x),weapon});
}

addEventListener("keydown",e=>{if(e.code==="Space"&&authenticated)shoot()});
function shoot(){if(!profile||performance.now()-lastShot<230)return;lastShot=performance.now();send({type:"shoot",angle:angleToMouse(),weapon})}
function angleToMouse(){return Math.atan2(mouse.y-H/2,mouse.x-W/2)}
function renderShop(){if(!profile)return;renderDroneShop();const el=document.getElementById("shipList");el.innerHTML=Object.entries(ships).map(([id,s])=>{const owned=profile.ownedShips?.includes(id),equipped=profile.ship===id;return `<div class="shipcard"><h4>${escapeHtml(s.name)}</h4><div class="ship-preview" style="--ship-accent:${escapeHtml(s.color||"#5ceaff")}">✦</div><p>Hülle ${s.hp} · Schild ${s.shield}<br>Tempo ${s.speed} · Schaden ${s.damage}</p><div class="price">${s.price===0?"GRATIS":s.price+" Credits"}</div><button data-ship="${id}" ${equipped?"disabled":""}>${equipped?"Ausgerüstet":owned?"Ausrüsten":"Kaufen & ausrüsten"}</button></div>`}).join("");el.querySelectorAll("[data-ship]").forEach(b=>b.onclick=()=>send({type:"buyShip",ship:b.dataset.ship}))}
function renderDroneShop(){
 if(!profile)return;
 const count=Math.max(0,Math.min(8,Number(profile.drones)||0)),price=200*(count+1);
 const info=document.getElementById("droneInfo"),button=document.getElementById("buyDrone");
 info.textContent=`${count} / 8 Begleitdrohnen · ${count?count+" zusätzliche Laserschüsse pro Salve":"Noch keine Drohnen"}`;
 button.textContent=count===8?"Alle Drohnen gekauft":`Drohne ${count+1} kaufen · ${price} Credits`;
 button.disabled=count===8||profile.credits<price;
}
document.getElementById("buyDrone").onclick=()=>send({type:"buyDrone"});
function worldToScreen(x,y){return {x:x-WORLD.x+W/2,y:y-WORLD.y+H/2}}const WORLD={x:1200,y:850};
// Procedural original ship artwork: no third-party game assets required.
function drawShip(x,y,a,color,scale=1,variant=0,thruster=false){
 ctx.save();ctx.translate(x,y);ctx.rotate(a);ctx.scale(scale,scale);
 const wing=variant%3,metal=ctx.createLinearGradient(-25,-18,28,20);
 metal.addColorStop(0,"#526e91");metal.addColorStop(.35,"#1c304b");metal.addColorStop(.68,"#a3bdd5");metal.addColorStop(1,"#14233d");
 ctx.shadowColor=color;ctx.shadowBlur=12;
 if(thruster){const flame=ctx.createLinearGradient(-38,0,-13,0);flame.addColorStop(0,"#27c8ff00");flame.addColorStop(.6,"#27c8ff99");flame.addColorStop(1,"#eaffff");ctx.fillStyle=flame;ctx.beginPath();ctx.moveTo(-13,-6);ctx.lineTo(-33-Math.random()*9,0);ctx.lineTo(-13,6);ctx.fill()}
 ctx.shadowBlur=0;
 // Armored swept wings, nacelles, and fuselage.
 ctx.fillStyle=metal;ctx.strokeStyle="#8cb1d2";ctx.lineWidth=1.1;
 ctx.beginPath();ctx.moveTo(10,0);ctx.lineTo(-8,-(wing===1?24:19));ctx.lineTo(-23,-18);ctx.lineTo(-15,-5);ctx.lineTo(-15,5);ctx.lineTo(-23,18);ctx.lineTo(-8,wing===1?24:19);ctx.closePath();ctx.fill();ctx.stroke();
 ctx.fillStyle="#0b1d32";ctx.beginPath();ctx.moveTo(26,0);ctx.lineTo(-8,-8);ctx.lineTo(-14,0);ctx.lineTo(-8,8);ctx.closePath();ctx.fill();ctx.stroke();
 ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=10;
 ctx.beginPath();ctx.moveTo(16,0);ctx.lineTo(-4,-3);ctx.lineTo(-7,0);ctx.lineTo(-4,3);ctx.closePath();ctx.fill();
 for(const side of [-1,1]){ctx.fillRect(-19,side*13-2,9,3);ctx.fillRect(-10,side*10-1,8,2)}
 ctx.shadowBlur=0;ctx.strokeStyle="#d4edff";ctx.beginPath();ctx.moveTo(-5,-6);ctx.lineTo(13,0);ctx.lineTo(-5,6);ctx.stroke();ctx.restore();
}
function drawDrones(x,y,color,clock,count=4,scale=1){
 for(let i=0;i<count;i++){
  const a=clock*.00045+i*Math.PI*2/count,dx=Math.cos(a)*39*scale,dy=Math.sin(a)*22*scale;
  ctx.save();ctx.translate(x+dx,y+dy);ctx.rotate(a+Math.PI/2);ctx.shadowBlur=8;ctx.shadowColor=color;
  ctx.fillStyle="#172e49";ctx.strokeStyle=color;ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(7,0);ctx.lineTo(0,7);ctx.lineTo(-7,0);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle="#e8faff";ctx.fillRect(-2,-2,4,4);ctx.restore();
 }
}
function drawNebulaBackdrop(mapId){
 const hues=mapId==="nebula"?["#612b79","#0b5581","#8b3772"]:mapId==="asteroid"?["#87623b","#1c5973","#72402e"]:["#075f75","#35266b","#17528a"];
 ctx.save();ctx.globalCompositeOperation="screen";
 for(let i=0;i<6;i++){
  const px=W*(.13+(i*0.271)%0.83)-WORLD.x*(.012+i*.002),py=H*(.15+(i*.173)%0.7)-WORLD.y*.012;
  const radius=Math.max(W,H)*(.25+(i%3)*.075);
  const g=ctx.createRadialGradient(px,py,0,px,py,radius);g.addColorStop(0,hues[i%3]+"55");g.addColorStop(.48,hues[i%3]+"1d");g.addColorStop(1,"#00000000");
  ctx.fillStyle=g;ctx.fillRect(px-radius,py-radius,radius*2,radius*2);
 }
 ctx.restore();
 // Distant original planet with atmospheric rim.
 const px=W*.82-WORLD.x*.018,py=H*.23-WORLD.y*.012,r=Math.min(W,H)*.18;
 const planet=ctx.createRadialGradient(px-r*.38,py-r*.45,r*.1,px,py,r);
 planet.addColorStop(0,"#4b7294");planet.addColorStop(.35,"#193b61");planet.addColorStop(.75,"#09152d");planet.addColorStop(1,"#030812");
 ctx.save();ctx.shadowColor="#4fc6f6";ctx.shadowBlur=25;ctx.fillStyle=planet;ctx.beginPath();ctx.arc(px,py,r,0,Math.PI*2);ctx.fill();ctx.restore();
}
function spawnExplosion(x,y,color="#ffad67"){
 if(explosions.length>55)explosions.shift();
 explosions.push({x,y,color,born:performance.now(),particles:Array.from({length:13},(_,i)=>({a:i*Math.PI*2/13+Math.random()*.3,v:24+Math.random()*65,r:1+Math.random()*3}))});
}
function drawExplosions(now){
 explosions=explosions.filter(e=>now-e.born<750);
 for(const e of explosions){const t=(now-e.born)/750,p=worldToScreen(e.x,e.y);ctx.save();ctx.globalAlpha=1-t;ctx.globalCompositeOperation="lighter";
 const glow=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,45*t+8);glow.addColorStop(0,"#ffffff");glow.addColorStop(.2,e.color);glow.addColorStop(1,"#00000000");ctx.fillStyle=glow;ctx.beginPath();ctx.arc(p.x,p.y,45*t+8,0,Math.PI*2);ctx.fill();
 for(const part of e.particles){ctx.fillStyle=e.color;ctx.beginPath();ctx.arc(p.x+Math.cos(part.a)*part.v*t,p.y+Math.sin(part.a)*part.v*t,part.r*(1-t)+.2,0,Math.PI*2);ctx.fill()}
 ctx.restore()}
}
function drawTargetRing(t){const p=worldToScreen(t.x,t.y);const radius=t===boss?85:30;
 ctx.save();ctx.translate(p.x,p.y);ctx.strokeStyle="#ffca56";ctx.lineWidth=2;ctx.shadowBlur=12;ctx.shadowColor="#fcb542";
 for(let i=0;i<4;i++){const a=performance.now()*.0005+i*Math.PI/2;ctx.beginPath();ctx.arc(0,0,radius,a,a+.43);ctx.stroke()}
 ctx.restore();
}
function draw(){
 ctx.clearRect(0,0,W,H);let tint=maps[profile?.map]?.tint||"#07162d";ctx.fillStyle=tint;ctx.fillRect(0,0,W,H);drawNebulaBackdrop(profile?.map);
 let cx=profile?.x??1200,cy=profile?.y??850;WORLD.x+=(cx-WORLD.x)*.16;WORLD.y+=(cy-WORLD.y)*.16;
 for(const s of stars){let x=((s.x-WORLD.x*.18+6000)%4000+4000)%4000/4000*W,y=((s.y-WORLD.y*.18+4000)%3000+3000)%3000/3000*H;ctx.globalAlpha=s.a;ctx.fillStyle="#b6e5ff";ctx.fillRect(x,y,s.r,s.r)}ctx.globalAlpha=1;
 for(const r of rocks){let p=worldToScreen(r.x,r.y);if(p.x<-60||p.x>W+60||p.y<-60||p.y>H+60)continue;r.rot+=r.spin*.016;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(r.rot);ctx.beginPath();for(let i=0;i<9;i++){let a=i/9*6.28,rr=r.r*(.8+.2*Math.sin(i*4+r.x));i?ctx.lineTo(Math.cos(a)*rr,Math.sin(a)*rr):ctx.moveTo(Math.cos(a)*rr,Math.sin(a)*rr)}ctx.closePath();ctx.fillStyle="#18283d";ctx.strokeStyle="#3b526d";ctx.fill();ctx.stroke();ctx.restore()}
 // Draw server projectiles, NPCs and other pilots.
 for(const q of shots){let p=worldToScreen(q.x,q.y);ctx.strokeStyle=q.weapon==="drone"?"#f9e27b":q.faction===profile?.faction?"#64f8ff":"#ff6686";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-q.vx*.02,p.y-q.vy*.02);ctx.stroke()}
 for(const n of npcs){let p=worldToScreen(n.x,n.y);if(p.x<-50||p.x>W+50||p.y<-50||p.y>H+50)continue;drawShip(p.x,p.y,Math.atan2(cy-n.y,cx-n.x)+Math.PI,"#ff5c7b",n.kind==="guard"?1.2:.8,2,true);ctx.fillStyle="#341421";ctx.fillRect(p.x-16,p.y-22,32,3);ctx.fillStyle="#ff5c7b";ctx.fillRect(p.x-16,p.y-22,32*n.hp/n.maxHp,3)}
 for(const p of remote){let s=worldToScreen(p.x,p.y);drawShip(s.x,s.y,Math.atan2(cy-p.y,cx-p.x),"#9affbd",.95,p.ship==="destroyer"?2:p.ship==="interceptor"?1:p.ship==="falcon"?1:p.ship==="leviathan"?2:0,true);drawDrones(s.x,s.y,"#67c9ff",performance.now()+p.x,p.drones||0,.9);ctx.font="11px system-ui";ctx.textAlign="center";ctx.fillStyle="#d7f5ff";ctx.fillText(p.username,s.x,s.y-24);ctx.fillStyle="#1d3549";ctx.fillRect(s.x-18,s.y-20,36,3);ctx.fillStyle="#7affb5";ctx.fillRect(s.x-18,s.y-20,36*Math.max(0,p.hp/p.maxHp),3)}
 if(boss&&profile?.map==="nebula"){let p=worldToScreen(boss.x,boss.y);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(performance.now()*.00015);ctx.beginPath();for(let i=0;i<12;i++){let a=i/12*6.28,rr=i%2?52:72;i?ctx.lineTo(Math.cos(a)*rr,Math.sin(a)*rr):ctx.moveTo(Math.cos(a)*rr,Math.sin(a)*rr)}ctx.closePath();ctx.fillStyle="#5b1d54";ctx.strokeStyle="#ff76df";ctx.lineWidth=3;ctx.shadowBlur=22;ctx.shadowColor="#ff4bd8";ctx.fill();ctx.stroke();ctx.restore();ctx.fillStyle="#30122b";ctx.fillRect(p.x-55,p.y-88,110,7);ctx.fillStyle="#ff62d7";ctx.fillRect(p.x-55,p.y-88,110*Math.max(0,boss.hp/boss.maxHp),7);ctx.fillStyle="#fff";ctx.textAlign="center";ctx.fillText("VOID LEVIATHAN",p.x,p.y-96)}
 if(profile){const ship=ships[profile.ship]||{color:"#55eaff"};drawShip(W/2,H/2,moveTarget?Math.atan2(moveTarget.y-profile.y,moveTarget.x-profile.x):angleToMouse(),ship.color||"#55eaff",profile.ship==="leviathan"?1.9:profile.ship==="destroyer"?1.75:1.5,profile.ship==="destroyer"||profile.ship==="leviathan"?2:profile.ship==="interceptor"||profile.ship==="falcon"?1:0,!!moveTarget);drawDrones(W/2,H/2,ship.color||"#55eaff",performance.now(),profile.drones||0,1.35);if(turbo>0){turbo-=.016;ctx.strokeStyle="#fff";ctx.beginPath();ctx.moveTo(W/2-12,H/2);ctx.lineTo(W/2-30,H/2);ctx.stroke()}}
 drawExplosions(performance.now());
 if(attackTarget){const selected=trackedTarget();if(selected)drawTargetRing(selected)}
 if(moveTarget){const marker=worldToScreen(moveTarget.x,moveTarget.y);ctx.strokeStyle="#7be9ff77";ctx.beginPath();ctx.arc(marker.x,marker.y,10,0,Math.PI*2);ctx.stroke()}
 // Minimap
 mctx.clearRect(0,0,180,110);mctx.fillStyle="#041126";mctx.fillRect(0,0,180,110);
 const mg=mctx.createRadialGradient(120,30,3,90,55,110);mg.addColorStop(0,"#286b7544");mg.addColorStop(1,"#020c1d00");mctx.fillStyle=mg;mctx.fillRect(0,0,180,110);
 mctx.strokeStyle="#1b4666";mctx.lineWidth=.6;for(let x=0;x<=180;x+=30){mctx.beginPath();mctx.moveTo(x,0);mctx.lineTo(x,110);mctx.stroke()}for(let y=0;y<=110;y+=22){mctx.beginPath();mctx.moveTo(0,y);mctx.lineTo(180,y);mctx.stroke()}mctx.strokeRect(1,1,178,108);let map=maps[profile?.map]||{width:2400,height:1700};for(const n of npcs){mctx.fillStyle="#ff5c7b";mctx.fillRect(n.x/map.width*178,n.y/map.height*108,3,3)}for(const p of remote){mctx.fillStyle=p.faction===profile?.faction?"#8cffb6":"#ffbe64";mctx.fillRect(p.x/map.width*178,p.y/map.height*108,4,4)}if(profile){const mx=profile.x/map.width*178,my=profile.y/map.height*108;mctx.fillStyle="#5ceaff";mctx.beginPath();mctx.arc(mx,my,3.8,0,Math.PI*2);mctx.fill();mctx.strokeStyle="#a9faff";mctx.strokeRect(mx-8,my-8,16,16)}if(boss&&profile?.map==="nebula"){mctx.fillStyle="#ff5bd4";mctx.fillRect(boss.x/map.width*178-3,boss.y/map.height*108-3,6,6)}
}
function loop(t){let dt=Math.min(.04,(t-last)/1000);last=t;if(authenticated&&profile){const ship=ships[profile.ship]||{speed:245};if(moveTarget&&!document.getElementById("hud").hidden){
 const dx=moveTarget.x-profile.x,dy=moveTarget.y-profile.y,dist=Math.hypot(dx,dy);
 if(dist<3){moveTarget=null}else{
  const step=Math.min(dist,ship.speed*(turbo>0?1.7:1)*dt);
  profile.x=Math.max(20,Math.min((maps[profile.map]?.width||2400)-20,profile.x+dx/dist*step));
  profile.y=Math.max(20,Math.min((maps[profile.map]?.height||1700)-20,profile.y+dy/dist*step));
  if(step>=dist-0.01)moveTarget=null;
 }
}if(t-lastSend>60){send({type:"move",x:profile.x,y:profile.y});lastSend=t}if(attackTarget&&!document.getElementById("hud").hidden){
 const target=trackedTarget();
 if(!target||target.hp<=0||Math.hypot(target.x-profile.x,target.y-profile.y)>850){attackTarget=null}
 else if(t-lastShot>230)shootAt(target);
}
if(mouse.down&&t-lastShot>230)shoot()}draw();if(noticeTimer>0){noticeTimer-=dt;if(noticeTimer<=0)document.getElementById("notice").textContent=""}requestAnimationFrame(loop)}
connect();requestAnimationFrame(loop);
})();