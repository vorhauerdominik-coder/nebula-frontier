(() => {
const canvas=document.getElementById("space"),ctx=canvas.getContext("2d"),mini=document.getElementById("minimap"),mctx=mini.getContext("2d");
let quality="auto",lowEffects=false,targetFps=60,frameAccumulator=0,qualityLowFrames=0,qualityHighFrames=0;
try{quality=localStorage.getItem("nf_quality")||"auto";targetFps=Number(localStorage.getItem("nf_fps_cap"))===30?30:60}catch{}
function updateQuality(){lowEffects=quality==="low"||(quality==="auto"&&qualityLowFrames>3);}
let mouseMode="click",touchMode="tap",keyboardMode="wasd";
try{mouseMode=localStorage.getItem("nf_mouse_mode")||"click";touchMode=localStorage.getItem("nf_touch_mode")||"tap";keyboardMode=localStorage.getItem("nf_keyboard_mode")||"wasd"}catch{}
let W=innerWidth,H=innerHeight,dpr=1;function resize(){dpr=Math.min(devicePixelRatio||1,quality==="low"?1:1.5);W=innerWidth;H=innerHeight;canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0)}addEventListener("resize",resize);resize();
let perfVisible=true,perfFps=0,perfFrames=0,perfStart=performance.now(),perfPing=null,perfSeq=0,perfPending=new Map(),perfLastPing=0,perfLastUi=0;
const perfPanel=document.getElementById("performancePanel");
const perfToggle=document.getElementById("performanceToggle");
try{perfVisible=localStorage.getItem("nf_performance_visible")!=="false"}catch{}
function setPerfVisible(value){
 perfVisible=value;perfPanel.hidden=!value;perfToggle.setAttribute("aria-pressed",String(value));
 perfToggle.textContent=value?"FPS / PING ausblenden":"FPS / PING anzeigen";
 try{localStorage.setItem("nf_performance_visible",String(value))}catch{}
}
perfToggle.onclick=()=>setPerfVisible(!perfVisible);setPerfVisible(perfVisible);
function refreshPerf(t){
 perfFrames++;
 if(t-perfStart>=750){perfFps=Math.round(perfFrames*1000/(t-perfStart));perfFrames=0;perfStart=t;}
 if(t-perfLastPing>2000&&ws?.readyState===WebSocket.OPEN){
  perfLastPing=t;const seq=++perfSeq;perfPending.set(seq,t);
  send({type:"ping",seq});
  for(const [key,time] of perfPending)if(t-time>7000)perfPending.delete(key);
  if(perfPending.size>3)perfPing=null;
 }
 if(perfVisible&&t-perfLastUi>=500){
  perfLastUi=t;
  document.getElementById("perfFps").textContent=perfFps+" FPS";
  document.getElementById("perfPing").textContent=perfPing===null?"— ms":Math.round(perfPing)+" ms";
  const fpsPct=Math.min(100,perfFps/60*100),pingPct=perfPing===null?0:Math.max(0,100-perfPing/3);
  document.getElementById("fpsMeter").style.width=fpsPct+"%";
  document.getElementById("pingMeter").style.width=pingPct+"%";
  document.getElementById("fpsMeter").className=perfFps<25?"bad":perfFps<45?"warn":"good";
  document.getElementById("pingMeter").className=perfPing===null||perfPing>180?"bad":perfPing>90?"warn":"good";
 }
}
let autoCpuState=null;
const engineClock=new NebulaEngine.GameClock();
const smoothNpcs=new NebulaEngine.SnapshotInterpolator();
const smoothPilots=new NebulaEngine.SnapshotInterpolator();
const cameraEngine=new NebulaEngine.Camera2D();
const particleEngine=new NebulaEngine.ParticlePool();
function blendEntities(list,cache,t){cache.update(list,t)}
function renderPosition(entity,cache){return cache.position(entity,performance.now())}
const combatFloats=[];
function addCombatFloat(d){if(!profile||d.map!==profile.map)return;combatFloats.push({x:d.x,y:d.y,amount:d.amount,kind:d.kind||"damage",born:performance.now(),offset:(Math.random()-.5)*24});if(combatFloats.length>90)combatFloats.shift();}
function drawCombatFloats(){const now=performance.now();for(let i=combatFloats.length-1;i>=0;i--){const f=combatFloats[i],age=(now-f.born)/1050;if(age>=1){combatFloats.splice(i,1);continue;}const p=worldToScreen(f.x+f.offset,f.y);ctx.save();ctx.globalAlpha=Math.min(1,(1-age)*2);ctx.font="bold 19px Arial, sans-serif";ctx.textAlign="center";ctx.lineWidth=3;ctx.strokeStyle="#240408";ctx.strokeText("-"+f.amount,p.x,p.y-36-age*66);ctx.fillStyle=f.kind==="shield"?"#69c9ff":"#ff3333";ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=9;ctx.fillText("-"+f.amount,p.x,p.y-36-age*66);ctx.restore();}}
let ws=null,authenticated=false,registerMode=false,profile=null,ships={},maps={},remote=[],npcs=[],shots=[],boss=null,portals=[],bonusBoxes=[],pirateBoxes=[],stars=[],rocks=[],keys={},mouse={x:W/2,y:H/2,down:false},moveTarget=null,attackTarget=null,last=performance.now(),lastSend=0,lastShot=0,weapon="pulse",noticeTimer=0,turbo=0,explosions=[];
for(let i=0;i<220;i++)stars.push({x:Math.random()*4000-2000,y:Math.random()*3000-1500,r:Math.random()*1.5+.3,a:Math.random()*.7+.2});
for(let i=0;i<55;i++)rocks.push({x:Math.random()*2600-1300,y:Math.random()*1800-900,r:10+Math.random()*35,rot:Math.random()*6.28,spin:(Math.random()-.5)*.3});
const send=o=>{if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(o))};
function connect(){const proto=location.protocol==="https:"?"wss:":"ws:";ws=new WebSocket(`${proto}//${location.host}`);ws.onopen=()=>{};ws.onmessage=e=>{let d;try{d=JSON.parse(e.data)}catch{return}handle(d)};ws.onclose=()=>{if(authenticated){notice("Verbindung getrennt. Seite neu laden, um erneut zu verbinden.");}else msg("Serververbindung fehlgeschlagen. Starte den Server mit npm start.");};ws.onerror=()=>{}}
function handle(d){
 if(d.type==="state"&&d.autoCpu)autoCpuState=d.autoCpu;
 if(d.type==="pong"){const sent=perfPending.get(d.seq);if(sent!==undefined){const rtt=performance.now()-sent;perfPing=perfPing===null?rtt:perfPing*.65+rtt*.35;perfPending.delete(d.seq)}return;}

 if(d.type==="error"){msg(d.text);notice(d.text);return}
 if(d.type==="authenticated"){authenticated=true;profile=d.self;ships=d.ships;maps=d.maps;remote=d.players||[];npcs=d.npcs||[];blendEntities(remote,smoothPilots,performance.now());blendEntities(npcs,smoothNpcs,performance.now());boss=d.boss;portals=d.portals||[];bonusBoxes=d.bonusBoxes||[];pirateBoxes=d.pirateBoxes||[];document.getElementById("auth").hidden=true;document.getElementById("lobby").hidden=false;document.getElementById("hud").hidden=true;updateUI();updateLobby();notice("WILLKOMMEN AN BORD");return}
 if(d.type==="state"){if(!profile)return;profile={...profile,...d.self};remote=(d.players||[]).filter(p=>p.username!==profile.username);const newNpcs=d.npcs||[];
 if(!document.getElementById("hud").hidden){const nextIds=new Set(newNpcs.map(n=>n.id));for(const old of npcs){if(!nextIds.has(old.id)&&old.hp>0)spawnExplosion(old.x,old.y,"#ff9764")}}
 npcs=newNpcs;blendEntities(remote,smoothPilots,performance.now());blendEntities(npcs,smoothNpcs,performance.now());shots=d.projectiles||[];boss=d.boss;portals=d.portals||[];bonusBoxes=d.bonusBoxes||[];pirateBoxes=d.pirateBoxes||[];
 if(performance.now()-(handle.lastHudUpdate||0)>300){handle.lastHudUpdate=performance.now();updateUI();}
 return}
 if(d.type==="profile"){profile={...profile,...d.profile};ships=d.ships||ships;maps=d.maps||maps;updateUI();updateLobby();renderShop();return}
 if(d.type==="pirateRemoved"){pirateBoxes=pirateBoxes.filter(b=>b.id!==d.id);return}
 if(d.type==="pirateSpawned"){if(profile?.map===d.map)pirateBoxes=d.boxes||[];return}
 if(d.type==="bonusRemoved"){bonusBoxes=bonusBoxes.filter(b=>b.id!==d.id);return}
 if(d.type==="bonusSpawned"){if(profile?.map===d.map)bonusBoxes=d.boxes||[];return}
 if(d.type==="mapChanged"){moveTarget=null;attackTarget=null;notice("KARTE GEWECHSELT");return}
 if(d.type==="combatFloat"){addCombatFloat(d);return}
 if(d.type==="npcDestroyed"){spawnExplosion(d.x,d.y,d.kind==="sentinel"?"#c782ff":"#ff9656");return}
 if(d.type==="chat"){addChat(d);return}
 if(d.type==="presence"){remote=(d.players||[]).filter(p=>p.username!==profile?.username);renderOnline();updateLobby();return}
 if(d.type==="notice"){notice(d.text);return}
 if(d.type==="reward"){if(profile){profile.credits=d.credits;profile.uridium=d.uridium??profile.uridium;profile.xp=d.xp;profile.level=d.level;profile.kills=d.kills;profile.quest=d.quest;updateUI()}return}
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

// V14: Same-origin second window. One account, one WebSocket, two independent views.
let commandWindow=null;
window.nebulaCommandBridge={
 snapshot(){return authenticated&&profile?{profile,ships,maps,remoteCount:remote.length,authenticated:true}:null},
 action(type,details={}){
  const allowed=["buyMarket","buyPremium","buyShip","buyDrone","buyUpgrade","useItem","claimQuest","fireRocket","selectAmmo","toggleCpu","setLoadout","buyEquipment","equipItem","unequipItem","buyBootyKey"];
  if(!authenticated||!allowed.includes(type))return false;
  send({type,...details});return true;
 },
 focusGame(){window.focus();if(authenticated)launchGame();}
};
function openCommandWindow(){
 if(!authenticated){notice("Bitte zuerst einloggen.");return;}
 if(commandWindow&&!commandWindow.closed){commandWindow.focus();return;}
 commandWindow=window.open("/command.html","NebulaFrontierCommand","width=1050,height=820,resizable=yes,scrollbars=yes");
 if(!commandWindow)notice("Pop-up blockiert! Bitte Pop-ups für diese Seite erlauben.");
 else{launchGame();notice("Kommandozentrale geöffnet – Spiel läuft weiter.");}
}


// V18: faithful star-chart arrangement with numbered jump routes.
// 1-1 and 1-8 are the two protected home sectors of each faction.
const starNodes=[
 ["1",40,355],["2",245,355],["3",440,250],["4",440,460],
 ["5",635,165],["6",635,385],["7",835,285],["8",1010,175],
 ["z1",830,535],["z2",1010,535],["z3",1010,655]
];
const starEdges=[["1","2"],["2","3"],["2","4"],["3","5"],["3","6"],["4","6"],["4","7"],["5","7"],["5","8"],["6","7"],["7","8"],["4","z1"],["6","z2"],["7","z3"],["z1","z2"],["z2","z3"]];
const starPalette=["#a63d22","#a96b26","#3866a3","#8b6d25","#405da3","#c69b37","#368f8a","#4d74aa","#6667b0","#8a527f","#665599"];
let starMapOpen=false,starMapFaction=null;
const starOverlay=document.getElementById("starMapOverlay");
function toggleStarMap(force){
 starMapOpen=typeof force==="boolean"?force:!starMapOpen;
 starOverlay.hidden=!starMapOpen;
 document.getElementById("starMapToggle").setAttribute("aria-expanded",String(starMapOpen));
 document.getElementById("starMapToggle").textContent=starMapOpen?"✕ STERNENSYSTEM SCHLIESSEN":"✧ STERNENSYSTEM";
 if(starMapOpen)renderStarMap();
}
document.getElementById("starMapToggle").onclick=()=>toggleStarMap();
document.getElementById("starMapClose").onclick=()=>toggleStarMap(false);
function renderStarMap(){
 if(!profile)return;
 const prefix=({Astra:"a",Vortex:"v",Helix:"h"})[profile.faction]||"a";
 const current=profile.map;
 document.getElementById("starMapFaction").textContent=(profile.faction||"").toUpperCase()+" · GALAXIE";
 document.getElementById("starMapCurrent").textContent="Aktueller Sektor: "+(maps[current]?.name||current);
 const points=Object.fromEntries(starNodes.map(([id,x,y])=>[id,{x,y}]));
 const svg=document.getElementById("starMapLines");
 svg.replaceChildren();
 const ns="http://www.w3.org/2000/svg";
 starEdges.forEach(([a,b],i)=>{
  const A=points[a],B=points[b],x1=A.x+75,y1=A.y+47,x2=B.x+75,y2=B.y+47;
  const mid=(x1+x2)/2,route=document.createElementNS(ns,"path");
  route.setAttribute("d",`M${x1} ${y1} H${mid} V${y2} H${x2}`);
  route.setAttribute("class","star-map-link");svg.appendChild(route);
  const label=document.createElementNS(ns,"text");label.setAttribute("x",String(mid+3));label.setAttribute("y",String((y1+y2)/2-5));
  label.setAttribute("class","star-map-jump");label.textContent="J"+(i+1);svg.appendChild(label);
 });
 const container=document.getElementById("starMapNodes");container.replaceChildren();
 starNodes.forEach(([id,x,y],i)=>{
  const mapId=id.startsWith("z")?id:prefix+"x"+id;
  const button=document.createElement("button");button.type="button";
  button.className="star-map-node"+(mapId===current?" current":"");
  button.style.left=x+"px";button.style.top=y+"px";button.style.setProperty("--nebula",starPalette[i]);
  const art=document.createElement("span");art.className="space-art";button.appendChild(art);
  const title=document.createElement("span");title.className="sector-name";
  title.textContent=id.startsWith("z")?"Z-"+id.slice(1):"1-"+id;button.appendChild(title);
  const sub=document.createElement("span");sub.className="sector-info";
  sub.textContent=id.startsWith("z")?"NEUTRAL":(profile.faction||"").toUpperCase();button.appendChild(sub);
  if(id==="1"||id==="8"){const home=document.createElement("span");home.className="home-flag";home.textContent="⌂ HEIMAT";button.appendChild(home);}
  button.title=(maps[mapId]?.name||mapId)+" – "+(mapId===current?"Aktueller Sektor":"Reise über Portale (E)");
  button.onclick=()=>notice("Reise nach "+(maps[mapId]?.name||mapId)+" nur über Sprungportale mit E möglich.");
  container.appendChild(button);
 });
}

function launchGame(){if(!authenticated)return;moveTarget=null;attackTarget=null;document.getElementById("lobby").hidden=true;document.getElementById("hud").hidden=false;notice("SEKTOR BETRETEN")}
document.getElementById("lobbyLaunch").onclick=openCommandWindow;
document.getElementById("lobbyLaunchNav").onclick=openCommandWindow;
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
document.getElementById("commandOpen").onclick=openCommandWindow;
document.getElementById("password").addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("authGo").click()});
function updateUI(){if(!profile)return;if(starMapOpen&&renderStarMap.lastMap!==profile.map){renderStarMap.lastMap=profile.map;renderStarMap();}const ship=ships[profile.ship]||{name:profile.ship,hp:100,shield:80,speed:240,damage:12,color:"#55eaff"};document.getElementById("pilotName").textContent=profile.username;document.getElementById("factionTag").textContent=profile.faction.toUpperCase();document.getElementById("hpText").textContent=Math.ceil(profile.hp);document.getElementById("shieldText").textContent=Math.ceil(profile.shield);document.getElementById("hpBar").style.width=Math.max(0,profile.hp/ship.hp*100)+"%";document.getElementById("shieldBar").style.width=Math.max(0,profile.shield/ship.shield*100)+"%";document.getElementById("xpText").textContent=profile.xp+" XP";document.getElementById("xpBar").style.width=Math.min(100,profile.xp/(profile.level*100)*100)+"%";document.getElementById("level").textContent=profile.level;document.getElementById("credits").textContent=profile.credits;document.getElementById("questText").textContent=profile.quest.claimed?"Quest abgeschlossen":`Zerstöre 5 NPCs · ${profile.quest.kills}/5`;document.getElementById("questBar").style.width=Math.min(100,profile.quest.kills/5*100)+"%";const mapSelect=document.getElementById("mapSelect");
 if(mapSelect.options.length!==Object.keys(maps).length){mapSelect.replaceChildren();for(const [id,m] of Object.entries(maps)){const o=document.createElement("option");o.value=id;o.textContent=m.name;mapSelect.appendChild(o);}}
 mapSelect.value=profile.map;document.getElementById("mapInfo").textContent=(maps[profile.map]?.name||profile.map)+" · "+remote.length+" Pilot(en)";if(!updateUI.lastOnline||updateUI.lastOnline!==remote.map(p=>p.id).join(",")){updateUI.lastOnline=remote.map(p=>p.id).join(",");renderOnline()}renderDroneShop()}
function renderOnline(){let el=document.getElementById("onlineList");if(!profile)return;const all=[{username:profile.username,faction:profile.faction,me:true},...remote];el.innerHTML=all.map(p=>`<div class="op"><span>${escapeHtml(p.username)}${p.me?" (du)":""}</span><span class="dot">${escapeHtml(p.faction||"")}</span></div>`).join("")||"Niemand online"}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function addChat(d){const log=document.getElementById("chatLog"),line=document.createElement("div");line.className="chatline";if(d.channel==="system"){line.innerHTML=`<span class="sys">[SYSTEM] ${escapeHtml(d.text)}</span>`}else line.innerHTML=`<span class="faction">[${escapeHtml(d.faction||"")}]</span> <b>${escapeHtml(d.username||"")}</b>: ${escapeHtml(d.text)}`;log.appendChild(line);while(log.children.length>45)log.firstChild.remove();log.scrollTop=log.scrollHeight}
document.getElementById("chatForm").onsubmit=e=>{e.preventDefault();const input=document.getElementById("chatInput"),text=input.value.trim();if(text)send({type:"chat",text});input.value=""};
document.getElementById("mapSelect").onchange=e=>{e.target.value=profile.map;notice("Kartenwechsel nur durch Sprungportale!");};
document.getElementById("claimQuest").onclick=()=>send({type:"claimQuest"});
document.getElementById("shopOpen").onclick=()=>{document.getElementById("shop").hidden=false;renderShop()};document.getElementById("shopClose").onclick=()=>document.getElementById("shop").hidden=true;
document.querySelectorAll("[data-upgrade]").forEach(b=>b.onclick=()=>send({type:"buyUpgrade",upgrade:b.dataset.upgrade}));
document.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>action(b.dataset.action));
function action(a){if(!profile)return;if(a==="repair"){profile.hp=Math.min((ships[profile.ship]?.hp||100),profile.hp+35);send({type:"save"});notice("REPARATUR-PROTOKOLL");}if(a==="shield"){profile.shield=ships[profile.ship]?.shield||80;notice("SCHILD-IMPULS");send({type:"save"})}if(a==="turbo"){turbo=3;notice("TURBO AKTIV")}}
addEventListener("keydown",e=>{if(["INPUT","SELECT","TEXTAREA"].includes(document.activeElement?.tagName)||!document.getElementById("gameSettingsDialog").hidden)return;keys[e.code]=true;if(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code))e.preventDefault();if(e.code==="Digit1")action("repair");if(e.code==="Digit2")action("shield");if(e.code==="Digit3")action("turbo");if(e.code==="Digit4")selectWeapon("cannon");if(e.code==="Digit5")selectWeapon("plasma");if(e.code==="Digit6")selectWeapon("pulse");if(e.code==="KeyR"&&authenticated&&document.activeElement?.tagName!=="INPUT")fireMarketRocket();if(e.code==="KeyE"&&authenticated&&!document.getElementById("hud").hidden)useNearestPortal();if(e.code==="KeyH"&&authenticated)document.getElementById("shop").hidden=!document.getElementById("shop").hidden});
addEventListener("keyup",e=>keys[e.code]=false);canvas.addEventListener("mousemove",e=>{mouse.x=e.clientX;mouse.y=e.clientY});canvas.addEventListener("contextmenu",e=>e.preventDefault());
canvas.addEventListener("mousedown",e=>{
 if(!authenticated||document.getElementById("hud").hidden)return;
 mouse.x=e.clientX;mouse.y=e.clientY;
 if(e.button===0&&tryCollectBonus(e.clientX,e.clientY))return;
 if(e.button===0&&mouseMode==="click"){moveTarget={x:profile.x+(e.clientX-W/2),y:profile.y+(e.clientY-H/2)}}
 if(e.button===2){mouse.down=true;shoot()}
});
addEventListener("mouseup",e=>{if(e.button===2)mouse.down=false});
let pointerFlight=false;
canvas.addEventListener("pointerdown",e=>{if(!authenticated||document.getElementById("hud").hidden||e.button!==0)return;
 if(e.pointerType==="touch"){e.preventDefault();if(tryCollectBonus(e.clientX,e.clientY))return;pointerFlight=touchMode==="drag";moveTarget={x:profile.x+e.clientX-W/2,y:profile.y+e.clientY-H/2};}
 else if(mouseMode==="hold"){pointerFlight=true;moveTarget={x:profile.x+e.clientX-W/2,y:profile.y+e.clientY-H/2};}
});
canvas.addEventListener("pointermove",e=>{if(!pointerFlight||!profile)return; if(e.pointerType==="touch"&&touchMode!=="drag")return;
 moveTarget={x:profile.x+e.clientX-W/2,y:profile.y+e.clientY-H/2};});
for(const name of ["pointerup","pointercancel","pointerleave"])canvas.addEventListener(name,()=>{pointerFlight=false});

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
let marketCategory="ammo";
const categoryNames={ammo:"Munition",resources:"Ressourcen",boosters:"Booster",rockets:"Raketen",weapons:"Waffen",equipment:"Ausrüstung",ships:"Schiffe",drones:"Drohnen"};
document.querySelectorAll("#marketTabs [data-category]").forEach(b=>b.onclick=()=>{
 marketCategory=b.dataset.category;
 document.querySelectorAll("#marketTabs button").forEach(x=>x.classList.toggle("active",x===b));
 renderMarket();
});
function renderMarket(){
 if(!profile)return;
 const inventory=profile.inventory||{},boosters=profile.boosters||{},market=profile.market||{};
 const holder=document.getElementById("marketItems"),legacy=document.getElementById("legacyHangar");
 document.getElementById("marketCredits").textContent=Number(profile.credits||0).toLocaleString("de-DE");
 document.getElementById("marketUridium").textContent=Number(profile.uridium||0).toLocaleString("de-DE");
 legacy.style.display=["ships","drones"].includes(marketCategory)?"block":"none";
 if(marketCategory==="ships"){holder.innerHTML="<div class='market-note'>Schiffe findest du im Flotten-Hangar darunter.</div>";return}
 if(marketCategory==="drones"){holder.innerHTML="<div class='market-note'>Drohnen und Verbesserungen findest du im Hangar darunter.</div>";return}
 const list=market[marketCategory]||[];const premium=marketCategory==="premium";
 holder.innerHTML=list.map(item=>{
  const owned=item.id==="plasma"||item.id==="cannon"?!!profile.weapons?.[item.id]:false;
  const qty=Number(inventory[item.id]||0);
  const expiry=Number(boosters[item.id]||0),remaining=Math.max(0,Math.ceil((expiry-Date.now())/60000));
  return `<article class="market-item"><div class="market-symbol">${({premium:"💎",ammo:"⚡",resources:"◆",boosters:"✦",rockets:"➤",weapons:"✹",equipment:"▣"})[marketCategory]}</div><div class="market-item-body"><h4>${escapeHtml(item.name)}</h4><p>${escapeHtml(item.desc||"")}</p><small>${remaining?"Aktiv: "+remaining+" Min.":owned?"Bereits freigeschaltet":qty?"Im Inventar: "+qty:""}</small></div><div class="market-buy"><b>${premium?item.uridiumPrice.toLocaleString("de-DE")+" 💎":item.price.toLocaleString("de-DE")+" C"}</b><button data-market="${item.id}" ${owned||(premium?profile.uridium<item.uridiumPrice:profile.credits<item.price)?"disabled":""}>${owned?"Besitzt du":"Kaufen"}</button></div></article>`
 }).join("");
 holder.querySelectorAll("[data-market]").forEach(b=>b.onclick=()=>send({type:premium?"buyPremium":"buyMarket",item:b.dataset.market}));
 const invEntries=Object.entries(inventory).filter(([id,n])=>n>0);
 document.getElementById("marketInventory").innerHTML="<b>Dein Inventar</b><div>"+(invEntries.length?invEntries.map(([id,n])=>`<span>${escapeHtml(id.replaceAll("_"," "))}: ${Number(n)}</span>`).join(""):"Noch leer")+"</div><div class='market-use'><button data-use='repair_kit'>Reparatur-Kit benutzen</button><button data-use='shield_cell'>Schildzelle benutzen</button><button id='fireRocketBtn'>Rakete abfeuern (R)</button></div>";
 document.querySelectorAll("[data-use]").forEach(b=>b.onclick=()=>send({type:"useItem",item:b.dataset.use}));
 document.getElementById("fireRocketBtn").onclick=fireMarketRocket;
}
function fireMarketRocket(){
 if(!profile)return;
 const rocket=profile.rocketAmmo||"plt2020";
 if(!(profile.inventory?.["rocket_"+rocket]>0))return notice("Keine "+rocket.toUpperCase()+" Raketen im Inventar!");
 send({type:"fireRocket",rocket,angle:angleToMouse()});
}
function renderShop(){if(!profile)return;renderMarket();renderDroneShop();updateUpgradeButtons();const el=document.getElementById("shipList");el.innerHTML=Object.entries(ships).map(([id,s])=>{const owned=profile.ownedShips?.includes(id),equipped=profile.ship===id;return `<div class="shipcard"><h4>${escapeHtml(s.name)}</h4><div class="ship-preview ${id==="goliath"?"goliath-preview":""}" style="--ship-accent:${escapeHtml(s.color||"#5ceaff")}">${id==="goliath"?'<img src="/assets/ships/goliath.png" alt="Goliath Kreuzer"/>':"✦"}</div><p>Hülle ${s.hp} · Schild ${s.shield}<br>Tempo ${s.speed} · Schaden ${s.damage}</p><div class="price">${s.price===0?"GRATIS":s.price+" "+(s.currency==="uridium"?"Uridium":"Credits")}</div><button data-ship="${id}" ${equipped?"disabled":""}>${equipped?"Ausgerüstet":owned?"Ausrüsten":"Kaufen & ausrüsten"}</button></div>`}).join("");el.querySelectorAll("[data-ship]").forEach(b=>b.onclick=()=>send({type:"buyShip",ship:b.dataset.ship}))}
function updateUpgradeButtons(){
 const names={damage:"Waffen-Kalibrierung",shield:"Schildtechnik",armor:"Panzerplatten",drone:"Drohnenlaser"};
 for(const [key,name] of Object.entries(names)){
  const b=document.querySelector(`[data-upgrade="${key}"]`);if(!b)continue;
  const lv=profile.upgrades?.[key]||0,price=(key==="drone"?250:key==="armor"?200:150)*(lv+1);
  b.innerHTML=`${name} · Stufe ${lv}/8 <span>${lv>=8?"MAX":price+" Credits"}</span>`;
  b.disabled=lv>=8||profile.credits<price;
 }
 const cannon=document.querySelector('[data-upgrade="cannon"]'),plasma=document.querySelector('[data-upgrade="plasma"]');
 if(cannon){cannon.disabled=!!profile.weapons?.cannon||profile.credits<500;cannon.textContent=profile.weapons?.cannon?"Schwere Kanone ✓":"Schwere Kanone · 500 Credits"}
 if(plasma){plasma.disabled=!!profile.weapons?.plasma||profile.credits<1300;plasma.textContent=profile.weapons?.plasma?"Plasma-Laser ✓":"Plasma-Laser · 1.300 Credits"}
}
function selectWeapon(type){
 if(!profile)return;
 if(type==="cannon"&&!profile.weapons?.cannon)return notice("Schwere Kanone zuerst im Hangar kaufen!");
 if(type==="plasma"&&!profile.weapons?.plasma)return notice("Plasma-Laser zuerst im Hangar kaufen!");
 weapon=type;document.getElementById("weaponName").textContent={pulse:"PULS-LASER",cannon:"SCHWERE KANONE",plasma:"PLASMA-LASER"}[type];notice("Waffe: "+document.getElementById("weaponName").textContent);
}
function renderDroneShop(){
 if(!profile)return;
 const count=Math.max(0,Math.min(8,Number(profile.drones)||0)),price=200*(count+1);
 const info=document.getElementById("droneInfo"),button=document.getElementById("buyDrone");
 info.textContent=`${count} / 8 Begleitdrohnen · ${count?count+" zusätzliche Laserschüsse pro Salve":"Noch keine Drohnen"}`;
 button.textContent=count===8?"Alle Drohnen gekauft":`Drohne ${count+1} kaufen · ${price} Credits`;
 button.disabled=count===8||profile.credits<price;
}
document.getElementById("buyDrone").onclick=()=>send({type:"buyDrone"});
// The portal button uses the same server-validated jump action as the E key.
const portalJumpControls=document.getElementById("portalJumpControls");
const portalJumpButton=document.getElementById("portalJumpButton");
let nearestJumpPortal=null;
function refreshPortalJumpButton(){
 if(!authenticated||!profile||document.getElementById("hud").hidden||starMapOpen){
  portalJumpControls.hidden=true;nearestJumpPortal=null;return;
 }
 let best=null,bestDistance=165;
 for(const portal of portals){
  const dist=Math.hypot(portal.x-profile.x,portal.y-profile.y);
  if(dist<bestDistance){best=portal;bestDistance=dist;}
 }
 nearestJumpPortal=best;
 portalJumpControls.hidden=!best;
 if(best)document.getElementById("portalJumpDestination").textContent="→ "+(best.name||maps[best.to]?.name||best.to.toUpperCase());
}
portalJumpButton.addEventListener("click",()=>{
 if(!nearestJumpPortal||!authenticated)return;
 send({type:"usePortal",id:nearestJumpPortal.id});
 portalJumpControls.hidden=true;
 nearestJumpPortal=null;
});
function useNearestPortal(){
 if(!profile)return;
 const p=portals.find(p=>Math.hypot(p.x-profile.x,p.y-profile.y)<165);
 if(p)send({type:"usePortal",id:p.id});
 else notice("Fliege in die Nähe eines Portals und drücke E.");
}
function drawPortals(){
 if(!profile)return;
 for(const portal of portals){
  const p=worldToScreen(portal.x,portal.y);
  if(p.x<-120||p.x>W+120||p.y<-120||p.y>H+120)continue;
  const t=performance.now()*.0012;
  ctx.save();ctx.translate(p.x,p.y);
  ctx.globalCompositeOperation="lighter";
  for(let j=0;j<3;j++){
   ctx.save();ctx.rotate(t*(j%2?-.4:.55)+j*Math.PI/3);
   ctx.strokeStyle=["#67e8ff","#7b7dff","#e4a8ff"][j];ctx.lineWidth=5-j;ctx.shadowBlur=18;ctx.shadowColor=ctx.strokeStyle;
   ctx.beginPath();ctx.ellipse(0,0,43+j*8,59+j*5,.16,0,Math.PI*1.75);ctx.stroke();ctx.restore();
  }
  const g=ctx.createRadialGradient(0,0,4,0,0,42);g.addColorStop(0,"#e9faffdd");g.addColorStop(.3,"#577cffee");g.addColorStop(1,"#13275900");
  ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(0,0,38,49,0,0,Math.PI*2);ctx.fill();
  ctx.restore();ctx.textAlign="center";ctx.font="bold 12px system-ui";ctx.fillStyle="#b8f5ff";
  ctx.fillText((portal.name||"SPRUNGPORTAL → "+portal.to.toUpperCase()),p.x,p.y-79);
  if(Math.hypot(portal.x-profile.x,portal.y-profile.y)<165){
   ctx.fillStyle="#ffffff";ctx.fillText("[E] SPRINGEN",p.x,p.y+83);
  }
 }
}
function worldToScreen(x,y){return {x:x-WORLD.x+W/2,y:y-WORLD.y+H/2}}const WORLD={x:1200,y:850};
// Procedural original ship artwork: no third-party game assets required.
function drawShip(x,y,a,color,scale=1,variant=0,thruster=false){
 ctx.save();ctx.translate(x,y);ctx.rotate(a);ctx.scale(scale,scale);
 const wing=variant%3,metal=ctx.createLinearGradient(-25,-18,28,20);
 metal.addColorStop(0,"#526e91");metal.addColorStop(.35,"#1c304b");metal.addColorStop(.68,"#a3bdd5");metal.addColorStop(1,"#14233d");
 ctx.shadowColor=color;ctx.shadowBlur=12;
 if(thruster){const flame=ctx.createLinearGradient(-38,0,-13,0);flame.addColorStop(0,"#27c8ff00");flame.addColorStop(.6,"#27c8ff99");flame.addColorStop(1,"#eaffff");ctx.fillStyle=flame;ctx.beginPath();ctx.moveTo(-13,-6);ctx.lineTo(-33-Math.random()*9,0);ctx.lineTo(-13,6);ctx.fill()}
 ctx.shadowBlur=0;
 // Engine nacelles and directional glows.
 for(const side of [-1,1]){
  ctx.fillStyle="#0b1526";ctx.strokeStyle="#7496b9";ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(-17,side*10);ctx.lineTo(-27,side*15);ctx.lineTo(-28,side*21);ctx.lineTo(-8,side*17);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle=color;ctx.shadowBlur=12;ctx.fillRect(-27,side*17-2,7,4);ctx.shadowBlur=0;
 }
 // Armored swept wings, nacelles, and fuselage.
 ctx.fillStyle=metal;ctx.strokeStyle="#8cb1d2";ctx.lineWidth=1.1;
 ctx.beginPath();ctx.moveTo(10,0);ctx.lineTo(-8,-(wing===1?24:19));ctx.lineTo(-23,-18);ctx.lineTo(-15,-5);ctx.lineTo(-15,5);ctx.lineTo(-23,18);ctx.lineTo(-8,wing===1?24:19);ctx.closePath();ctx.fill();ctx.stroke();
 ctx.fillStyle="#0b1d32";ctx.beginPath();ctx.moveTo(26,0);ctx.lineTo(-8,-8);ctx.lineTo(-14,0);ctx.lineTo(-8,8);ctx.closePath();ctx.fill();ctx.stroke();
 ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=10;
 ctx.beginPath();ctx.moveTo(16,0);ctx.lineTo(-4,-3);ctx.lineTo(-7,0);ctx.lineTo(-4,3);ctx.closePath();ctx.fill();
 for(const side of [-1,1]){ctx.fillRect(-19,side*13-2,9,3);ctx.fillRect(-10,side*10-1,8,2)}
 ctx.shadowBlur=0;
 ctx.strokeStyle="#45637e";ctx.lineWidth=.7;
 for(const side of [-1,1]){ctx.beginPath();ctx.moveTo(-13,side*12);ctx.lineTo(-5,side*8);ctx.lineTo(3,side*11);ctx.stroke()}
 ctx.fillStyle="#e7f8ff";ctx.beginPath();ctx.ellipse(3,0,5,2.5,0,0,Math.PI*2);ctx.fill();
 ctx.strokeStyle="#d4edff";ctx.beginPath();ctx.moveTo(-5,-6);ctx.lineTo(13,0);ctx.lineTo(-5,6);ctx.stroke();ctx.restore();
}
// Dedicated original crescent cruiser artwork loaded from our own transparent SVG.
const goliathSprite=new Image();
goliathSprite.src="/assets/ships/goliath.png";
function drawGoliath(x,y,a,color,scale=1,variant=0,thruster=false){
 ctx.save();ctx.translate(x,y);ctx.rotate(a);ctx.scale(scale,scale);
 if(thruster){ctx.shadowColor="#38dfff";ctx.shadowBlur=15;ctx.fillStyle="#39d9ff99";ctx.beginPath();ctx.moveTo(-23,-5);ctx.lineTo(-54-Math.random()*10,-7);ctx.lineTo(-23,1);ctx.fill();ctx.beginPath();ctx.moveTo(-23,6);ctx.lineTo(-48-Math.random()*10,9);ctx.lineTo(-23,12);ctx.fill();ctx.shadowBlur=0}
 if(goliathSprite.complete&&goliathSprite.naturalWidth)ctx.drawImage(goliathSprite,-43,-32,86,64);
 else {ctx.fillStyle="#a8bacb";ctx.beginPath();ctx.moveTo(39,0);ctx.lineTo(-25,-30);ctx.lineTo(-12,0);ctx.lineTo(-25,30);ctx.closePath();ctx.fill()}
 ctx.restore();
}
function drawDrones(x,y,color,clock,count=4,scale=1){
 for(let i=0;i<count;i++){
  const a=clock*.00045+i*Math.PI*2/count,dx=Math.cos(a)*39*scale,dy=Math.sin(a)*22*scale;
  ctx.save();ctx.translate(x+dx,y+dy);ctx.rotate(a+Math.PI/2);ctx.shadowBlur=8;ctx.shadowColor=color;
  ctx.fillStyle="#172e49";ctx.strokeStyle=color;ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(7,0);ctx.lineTo(0,7);ctx.lineTo(-7,0);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle="#e8faff";ctx.fillRect(-2,-2,4,4);
  ctx.strokeStyle="#ffffff77";ctx.beginPath();ctx.moveTo(-5,0);ctx.lineTo(5,0);ctx.stroke();ctx.restore();
 }
}
function drawNebulaBackdrop(mapId){
 const palette=[["#075f75","#35266b","#17528a"],["#127b9d","#1e367c","#295875"],["#87623b","#1c5973","#72402e"],["#316f73","#204a84","#478e9a"],["#612b79","#0b5581","#8b3772"],["#7b305f","#245781","#6e4a9a"],["#9d422a","#69316f","#79543b"],["#612b79","#0b5581","#8b3772"]];const hues=palette[Math.max(0,Math.min(7,Number((mapId||"x1").slice(1))-1))];
 ctx.save();ctx.globalCompositeOperation="screen";
 for(let i=0;i<6;i++){
  const px=W*(.13+(i*0.271)%0.83)-WORLD.x*(.012+i*.002),py=H*(.15+(i*.173)%0.7)-WORLD.y*.012;
  const radius=Math.max(W,H)*(.25+(i%3)*.075);
  const g=ctx.createRadialGradient(px,py,0,px,py,radius);g.addColorStop(0,hues[i%3]+"55");g.addColorStop(.48,hues[i%3]+"1d");g.addColorStop(1,"#00000000");
  ctx.fillStyle=g;ctx.fillRect(px-radius,py-radius,radius*2,radius*2);
 }
 ctx.restore();
 // Nebula filaments, distant dust and soft light shafts.
 const t=performance.now()*.000025;
 ctx.save();ctx.globalCompositeOperation="screen";
 for(let i=0;i<4;i++){
  const ox=W*(.12+i*.26)+Math.sin(t+i)*22,oy=H*(.16+i*.17);
  const g=ctx.createLinearGradient(ox-200,oy-140,ox+250,oy+180);
  g.addColorStop(0,"#00000000");g.addColorStop(.47,i%2?"#b43d7411":"#1fa9e21a");g.addColorStop(.53,"#8ddcfb10");g.addColorStop(1,"#00000000");
  ctx.fillStyle=g;ctx.save();ctx.translate(ox,oy);ctx.rotate(-.42+i*.15);ctx.fillRect(-W*.7,-24,W*1.4,48);ctx.restore();
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
// Glowing galaxy bonus-box sprite, inspired by the supplied reference image.
// Cached offscreen so the detailed glow does not need to be rebuilt every frame.
const bonusSprite=document.createElement("canvas");bonusSprite.width=128;bonusSprite.height=128;
(function makeBonusSprite(){
 const c=bonusSprite.getContext("2d"),cx=64,cy=64;
 const glow=c.createRadialGradient(cx,cy,3,cx,cy,60);
 glow.addColorStop(0,"rgba(255,255,241,1)");glow.addColorStop(.18,"rgba(255,234,145,.98)");
 glow.addColorStop(.33,"rgba(255,164,64,.85)");glow.addColorStop(.50,"rgba(95,128,255,.48)");
 glow.addColorStop(.78,"rgba(33,79,209,.19)");glow.addColorStop(1,"rgba(20,41,100,0)");
 c.fillStyle=glow;c.fillRect(0,0,128,128);
 c.save();c.translate(cx,cy);c.rotate(-.16);
 for(let i=3;i>=0;i--){let r=25+i*3;c.beginPath();c.roundRect(-r,-r,r*2,r*2,7);
 c.strokeStyle=["#fff8cd","#ffc866","#eaa34f","#698cfc"][i];c.globalAlpha=.72-i*.10;c.lineWidth=2.7+i*.9;c.stroke()}
 c.globalAlpha=1;
 const core=c.createRadialGradient(-4,-5,1,0,0,30);
 core.addColorStop(0,"#ffffff");core.addColorStop(.48,"#fffbe1");core.addColorStop(.8,"#ffe09b");core.addColorStop(1,"rgba(255,171,74,0)");
 c.fillStyle=core;c.fillRect(-30,-30,60,60);c.restore();
 // Deterministic sparkles so every player sees the same visual.
 for(let i=0;i<22;i++){let a=i*2.39996,r=27+(i*17%31),x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r;
 c.fillStyle=i%3===0?"rgba(255,238,182,.9)":"rgba(158,196,255,.75)";
 c.beginPath();c.arc(x,y,i%5===0?1.5:.7,0,Math.PI*2);c.fill()}
})();
function drawPirateBoxes(){
 const time=performance.now();
 for(const b of pirateBoxes){
  const pos=worldToScreen(b.x,b.y);if(pos.x<-50||pos.x>W+50||pos.y<-50||pos.y>H+50)continue;
  const near=profile&&Math.hypot(profile.x-b.x,profile.y-b.y)<90;
  ctx.save();ctx.translate(pos.x,pos.y+Math.sin(time*.002+b.x)*2);
  ctx.shadowColor="#00ff7c";ctx.shadowBlur=18;ctx.rotate(Math.PI/4);
  ctx.fillStyle="#075a31";ctx.strokeStyle="#79ffa4";ctx.lineWidth=3;
  ctx.fillRect(-12,-12,24,24);ctx.strokeRect(-12,-12,24,24);
  ctx.fillStyle="#a4ffc2";ctx.fillRect(-5,-5,10,10);ctx.restore();
  if(near){ctx.fillStyle="#adffcb";ctx.textAlign="center";ctx.font="11px system-ui";ctx.fillText("PIRATENBOX · 1 KEY",pos.x,pos.y-27)}
 }
}
function drawBonusBoxes(){
 const time=performance.now();
 for(const b of bonusBoxes){
  const pos=worldToScreen(b.x,b.y);
  if(pos.x<-48||pos.x>W+48||pos.y<-48||pos.y>H+48)continue;
  const near=profile&&Math.hypot(profile.x-b.x,profile.y-b.y)<90;
  const pulse=1+Math.sin(time*.003+b.x)*.045;
  ctx.save();ctx.translate(pos.x,pos.y+Math.sin(time*.002+b.x)*2.5);
  ctx.globalAlpha=near?1:.92;
  const size=(lowEffects?24:29)*pulse;
  ctx.drawImage(bonusSprite,-size/2,-size/2,size,size);
  if(near){ctx.strokeStyle="rgba(255,217,113,.85)";ctx.lineWidth=1.2;
   ctx.strokeRect(-10,-10,20,20)}
  ctx.restore();
  if(near){ctx.fillStyle="#ffe6a2";ctx.font="11px system-ui";ctx.textAlign="center";
   ctx.fillText("BONUS · ANTIPPEN",pos.x,pos.y-23)}
 }
}
function tryCollectBonus(clientX,clientY){
 if(!profile||document.getElementById("hud").hidden)return false;
 const x=profile.x+clientX-W/2,y=profile.y+clientY-H/2;
 const pirate=pirateBoxes.find(b=>Math.hypot(b.x-x,b.y-y)<22);
 if(pirate){if(Math.hypot(profile.x-pirate.x,profile.y-pirate.y)>90){moveTarget={x:pirate.x,y:pirate.y};notice("Fliege zur Piratenbox und tippe erneut.");}else send({type:"openPirateBox",id:pirate.id});return true;}
 const box=bonusBoxes.find(b=>Math.hypot(b.x-x,b.y-y)<19);
 if(!box)return false;
 if(Math.hypot(profile.x-box.x,profile.y-box.y)>90){moveTarget={x:box.x,y:box.y};notice("Fliege zur Bonusbox und tippe sie erneut an.");}
 else send({type:"collectBonus",id:box.id});
 return true;
}
function draw(){
 ctx.clearRect(0,0,W,H);let tint=maps[profile?.map]?.tint||"#07162d";ctx.fillStyle=tint;ctx.fillRect(0,0,W,H);drawNebulaBackdrop(profile?.map);
 let cx=profile?.x??1200,cy=profile?.y??850;cameraEngine.x=WORLD.x;cameraEngine.y=WORLD.y;cameraEngine.follow(cx,cy,draw.dt||16);WORLD.x=cameraEngine.x;WORLD.y=cameraEngine.y;
 for(const s of (lowEffects?stars.slice(0,Math.min(70,stars.length)):stars)){let x=((s.x-WORLD.x*.18+6000)%4000+4000)%4000/4000*W,y=((s.y-WORLD.y*.18+4000)%3000+3000)%3000/3000*H;ctx.globalAlpha=s.a;ctx.fillStyle="#b6e5ff";ctx.fillRect(x,y,s.r,s.r)}ctx.globalAlpha=1;
 for(const r of (lowEffects?rocks.slice(0,Math.min(18,rocks.length)):rocks)){let p=worldToScreen(r.x,r.y);if(p.x<-60||p.x>W+60||p.y<-60||p.y>H+60)continue;r.rot+=r.spin*.016;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(r.rot);ctx.beginPath();for(let i=0;i<9;i++){let a=i/9*6.28,rr=r.r*(.8+.2*Math.sin(i*4+r.x));i?ctx.lineTo(Math.cos(a)*rr,Math.sin(a)*rr):ctx.moveTo(Math.cos(a)*rr,Math.sin(a)*rr)}ctx.closePath();const rockFill=ctx.createLinearGradient(-r.r,-r.r,r.r,r.r);rockFill.addColorStop(0,"#617084");rockFill.addColorStop(.33,"#2c3d50");rockFill.addColorStop(1,"#0c1524");ctx.fillStyle=rockFill;ctx.strokeStyle="#54697d";ctx.fill();ctx.stroke();ctx.fillStyle="#071423aa";ctx.beginPath();ctx.arc(-r.r*.24,r.r*.15,r.r*.18,0,Math.PI*2);ctx.fill();ctx.restore()}
 // Draw server projectiles, NPCs and other pilots.
 drawPortals();
 drawBonusBoxes();drawPirateBoxes();
 for(const q of shots){let p=worldToScreen(q.x,q.y);if(p.x<-60||p.x>W+60||p.y<-60||p.y>H+60)continue;ctx.strokeStyle=q.ammo==="sab"?"#8effd1":q.ammo==="x6"?"#ff55dc":q.ammo==="x4"?"#e77cff":q.ammo==="x3"?"#ffad55":q.ammo==="x2"?"#9cddff":q.weapon==="rocket"?"#ffb348":q.weapon==="plasma"?"#bb7aff":q.weapon==="cannon"?"#ffbc64":q.weapon==="drone"?"#f9e27b":q.weapon==="enemy"?"#ff4568":q.faction===profile?.faction?"#64f8ff":"#ff6686";ctx.lineWidth=q.weapon==="plasma"?6:q.weapon==="cannon"?4:q.weapon==="drone"?2.4:3;ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=lowEffects?0:q.weapon==="plasma"?25:14;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-q.vx*.026,p.y-q.vy*.026);ctx.stroke();if(q.weapon==="plasma"){ctx.fillStyle="#eacaff";ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fill()}ctx.shadowBlur=0}
 for(const raw of npcs){const n=renderPosition(raw,smoothNpcs,draw.dt||16);let p=worldToScreen(n.x,n.y);if(p.x<-50||p.x>W+50||p.y<-50||p.y>H+50)continue;drawShip(p.x,p.y,Math.atan2(cy-n.y,cx-n.x)+Math.PI,({scout:"#ff6d77",interceptor:"#ffb65c",raider:"#e46bff",sentinel:"#9d6cff"})[n.kind]||"#ff5c7b",({scout:.85,interceptor:1,raider:1.25,sentinel:1.6})[n.kind]||1, n.kind==="interceptor"?1:2,true);
 ctx.font="10px system-ui";ctx.textAlign="center";ctx.fillStyle="#f5c9ff";ctx.fillText(({scout:"SPÄHER",interceptor:"JÄGER",raider:"PLÜNDERER",sentinel:"WÄCHTER"})[n.kind]||"NPC",p.x,p.y-33);ctx.fillStyle="#341421";ctx.fillRect(p.x-16,p.y-22,32,3);ctx.fillStyle="#ff5c7b";ctx.fillRect(p.x-16,p.y-22,32*n.hp/n.maxHp,3)}
 for(const raw of remote){const p=renderPosition(raw,smoothPilots,draw.dt||16);let s=worldToScreen(p.x,p.y);if(s.x<-100||s.x>W+100||s.y<-100||s.y>H+100)continue;(p.ship==="goliath"?drawGoliath:drawShip)(s.x,s.y,Math.atan2(cy-p.y,cx-p.x),"#9affbd",.95,p.ship==="destroyer"?2:p.ship==="interceptor"?1:p.ship==="falcon"?1:p.ship==="leviathan"?2:0,true);if(!lowEffects)drawDrones(s.x,s.y,"#67c9ff",performance.now()+p.x,p.drones||0,.9);ctx.font="11px system-ui";ctx.textAlign="center";ctx.fillStyle="#d7f5ff";ctx.fillText(p.username,s.x,s.y-24);ctx.fillStyle="#1d3549";ctx.fillRect(s.x-18,s.y-20,36,3);ctx.fillStyle="#7affb5";ctx.fillRect(s.x-18,s.y-20,36*Math.max(0,p.hp/p.maxHp),3)}
 if(boss&&profile?.map==="z3"){let p=worldToScreen(boss.x,boss.y);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(performance.now()*.00015);ctx.beginPath();for(let i=0;i<12;i++){let a=i/12*6.28,rr=i%2?52:72;i?ctx.lineTo(Math.cos(a)*rr,Math.sin(a)*rr):ctx.moveTo(Math.cos(a)*rr,Math.sin(a)*rr)}ctx.closePath();ctx.fillStyle="#5b1d54";ctx.strokeStyle="#ff76df";ctx.lineWidth=3;ctx.shadowBlur=22;ctx.shadowColor="#ff4bd8";ctx.fill();ctx.stroke();ctx.restore();ctx.fillStyle="#30122b";ctx.fillRect(p.x-55,p.y-88,110,7);ctx.fillStyle="#ff62d7";ctx.fillRect(p.x-55,p.y-88,110*Math.max(0,boss.hp/boss.maxHp),7);ctx.fillStyle="#fff";ctx.textAlign="center";ctx.fillText("VOID TITAN · Z3",p.x,p.y-96)}
 if(profile){const ship=ships[profile.ship]||{color:"#55eaff"};(profile.ship==="goliath"?drawGoliath:drawShip)(W/2,H/2,moveTarget?Math.atan2(moveTarget.y-profile.y,moveTarget.x-profile.x):angleToMouse(),ship.color||"#55eaff",profile.ship==="goliath"?1.65:profile.ship==="leviathan"?1.9:profile.ship==="destroyer"?1.75:1.5,profile.ship==="destroyer"||profile.ship==="leviathan"?2:profile.ship==="interceptor"||profile.ship==="falcon"?1:0,!!moveTarget);drawDrones(W/2,H/2,ship.color||"#55eaff",performance.now(),profile.drones||0,1.35);if(turbo>0){turbo-=.016;ctx.strokeStyle="#fff";ctx.beginPath();ctx.moveTo(W/2-12,H/2);ctx.lineTo(W/2-30,H/2);ctx.stroke()}}
 drawExplosions(performance.now());particleEngine.draw(ctx,worldToScreen);drawCombatFloats();
 if(attackTarget){const selected=trackedTarget();if(selected)drawTargetRing(selected)}
 if(moveTarget){const marker=worldToScreen(moveTarget.x,moveTarget.y);ctx.strokeStyle="#7be9ff77";ctx.beginPath();ctx.arc(marker.x,marker.y,10,0,Math.PI*2);ctx.stroke()}
 // Minimap
 mctx.clearRect(0,0,180,110);mctx.fillStyle="#041126";mctx.fillRect(0,0,180,110);
 const mg=mctx.createRadialGradient(120,30,3,90,55,110);mg.addColorStop(0,"#286b7544");mg.addColorStop(1,"#020c1d00");mctx.fillStyle=mg;mctx.fillRect(0,0,180,110);
 mctx.strokeStyle="#1b4666";mctx.lineWidth=.6;for(let x=0;x<=180;x+=30){mctx.beginPath();mctx.moveTo(x,0);mctx.lineTo(x,110);mctx.stroke()}for(let y=0;y<=110;y+=22){mctx.beginPath();mctx.moveTo(0,y);mctx.lineTo(180,y);mctx.stroke()}mctx.strokeRect(1,1,178,108);let map=maps[profile?.map]||{width:2400,height:1700};for(const portal of portals){mctx.fillStyle="#74dfff";mctx.beginPath();mctx.arc(portal.x/map.width*178,portal.y/map.height*108,4,0,Math.PI*2);mctx.fill()}for(const b of bonusBoxes){mctx.fillStyle="#78e8ff";mctx.fillRect(b.x/map.width*178,b.y/map.height*108,2,2)}for(const n of npcs){mctx.fillStyle="#ff5c7b";mctx.fillRect(n.x/map.width*178,n.y/map.height*108,3,3)}for(const p of remote){mctx.fillStyle=p.faction===profile?.faction?"#8cffb6":"#ffbe64";mctx.fillRect(p.x/map.width*178,p.y/map.height*108,4,4)}if(profile){const mx=profile.x/map.width*178,my=profile.y/map.height*108;mctx.fillStyle="#5ceaff";mctx.beginPath();mctx.arc(mx,my,3.8,0,Math.PI*2);mctx.fill();mctx.strokeStyle="#a9faff";mctx.strokeRect(mx-8,my-8,16,16)}if(boss&&profile?.map==="z3"){mctx.fillStyle="#ff5bd4";mctx.fillRect(boss.x/map.width*178-3,boss.y/map.height*108-3,6,6)}
}
function updateCpuHud(){
 const panel=document.getElementById("autoCpuHud");
 if(!profile){panel.hidden=true;return;}
 const owned=profile.cpus||{},enabled=profile.cpuEnabled||{};
 panel.hidden=!owned.rocket&&!owned.launcher;
 if(panel.hidden)return;
 const ammo=profile.rocketAmmo||"plt2020";
 document.getElementById("cpuAmmo").textContent=ammo.toUpperCase()+" · "+(profile.inventory?.["rocket_"+ammo]||0);
 const now=Date.now();
 for(const [kind,label,time,bar,delay] of [["rocket","cpuRocketLabel","cpuRocketTime","cpuRocketBar",2500],["launcher","cpuLauncherLabel","cpuLauncherTime","cpuLauncherBar",5000]]){
  const active=!!owned[kind]&&!!enabled[kind]&&(kind!=="launcher"||!!profile.launcher);
  document.getElementById(label).textContent=(kind==="rocket"?"RAKETEN":"LAUNCHER")+"-CPU "+(active?"AUTO AN":"AUS");
  const remaining=Math.max(0,(autoCpuState?.[kind]?.readyAt||0)-now);
  document.getElementById(time).textContent=active?(remaining>0?(remaining/1000).toFixed(1)+" s":"BEREIT"):"—";
  document.getElementById(bar).style.width=(active?Math.max(0,100-remaining/delay*100):0)+"%";
 }
}
function loop(t){
 const elapsed=t-(loop.prev||t);loop.prev=t;
 if(elapsed<1000/targetFps-2){requestAnimationFrame(loop);return;}
 draw.dt=engineClock.tick(t);particleEngine.update(draw.dt);
 if(quality==="auto"&&perfFps>0){
  if(perfFps<38){qualityLowFrames++;qualityHighFrames=0;}
  else if(perfFps>54){qualityHighFrames++;if(qualityHighFrames>20){qualityLowFrames=0;qualityHighFrames=0;}}
  updateQuality();
 }
 refreshPerf(t);if(t-(loop.lastPortalHud||0)>120){loop.lastPortalHud=t;refreshPortalJumpButton();}if(t-(loop.lastCpuHud||0)>200){loop.lastCpuHud=t;updateCpuHud();}let dt=Math.min(.04,(t-last)/1000);last=t;if(authenticated&&profile){const ship=ships[profile.ship]||{speed:245};if(keyboardMode!=="off"&&document.getElementById("gameSettingsDialog").hidden&&!document.getElementById("hud").hidden){
 const useW=keyboardMode==="wasd";let vx=Number(!!(keys.ArrowRight||(useW&&keys.KeyD)))-Number(!!(keys.ArrowLeft||(useW&&keys.KeyA)));
 let vy=Number(!!(keys.ArrowDown||(useW&&keys.KeyS)))-Number(!!(keys.ArrowUp||(useW&&keys.KeyW)));
 if(vx||vy){const norm=Math.hypot(vx,vy);moveTarget={x:profile.x+vx/norm*300,y:profile.y+vy/norm*300};}
 else if(loop.wasKeyboardMoving){moveTarget=null;}
 loop.wasKeyboardMoving=!!(vx||vy);
}
 if(moveTarget&&!document.getElementById("hud").hidden){
 const dx=moveTarget.x-profile.x,dy=moveTarget.y-profile.y,dist=Math.hypot(dx,dy);
 if(dist<3){moveTarget=null}else{
  const step=Math.min(dist,ship.speed*(turbo>0?1.7:1)*dt);
  profile.x=Math.max(20,Math.min((maps[profile.map]?.width||2400)-20,profile.x+dx/dist*step));
  profile.y=Math.max(20,Math.min((maps[profile.map]?.height||1700)-20,profile.y+dy/dist*step));
  if(step>=dist-0.01)moveTarget=null;
 }
}if(t-lastSend>85){send({type:"move",x:profile.x,y:profile.y});lastSend=t}if(attackTarget&&!document.getElementById("hud").hidden){
 const target=trackedTarget();
 if(!target||target.hp<=0||Math.hypot(target.x-profile.x,target.y-profile.y)>850){attackTarget=null}
 else if(t-lastShot>230)shootAt(target);
}
if(mouse.down&&t-lastShot>230)shoot()}draw();if(noticeTimer>0){noticeTimer-=dt;if(noticeTimer<=0)document.getElementById("notice").textContent=""}requestAnimationFrame(loop)}
const settings=document.getElementById("performanceSettings");
if(settings){settings.innerHTML='<label>Grafik <select id="qualitySelect"><option value="auto">Automatisch</option><option value="high">Hoch</option><option value="low">Sparmodus</option></select></label><label>FPS <select id="fpsSelect"><option value="60">60 FPS</option><option value="30">30 FPS (Akku)</option></select></label>';
 const q=document.getElementById("qualitySelect"),f=document.getElementById("fpsSelect");q.value=quality;f.value=String(targetFps);
 q.onchange=()=>{quality=q.value;qualityLowFrames=0;updateQuality();localStorage.setItem("nf_quality",quality);resize()};
 f.onchange=()=>{targetFps=Number(f.value);localStorage.setItem("nf_fps_cap",String(targetFps))};
}
const gameDialog=document.getElementById("gameSettingsDialog"),gameToggle=document.getElementById("gameSettingsToggle");
const gameControls={quality:document.getElementById("gameQuality"),fps:document.getElementById("gameFps"),mouse:document.getElementById("gameMouse"),touch:document.getElementById("gameTouch"),keyboard:document.getElementById("gameKeyboard")};
function syncGameSettings(){gameControls.quality.value=quality;gameControls.fps.value=String(targetFps);gameControls.mouse.value=mouseMode;gameControls.touch.value=touchMode;gameControls.keyboard.value=keyboardMode;const q=document.getElementById("qualitySelect"),f=document.getElementById("fpsSelect");if(q)q.value=quality;if(f)f.value=String(targetFps);}
function setGameSettingsOpen(open){gameDialog.hidden=!open;gameToggle.setAttribute("aria-expanded",String(open));if(open){syncGameSettings();document.getElementById("gameSettingsClose").focus();}else{gameToggle.focus();}}
gameToggle.onclick=()=>setGameSettingsOpen(gameDialog.hidden);
document.getElementById("gameSettingsClose").onclick=()=>setGameSettingsOpen(false);
document.getElementById("gameSettingsDone").onclick=()=>setGameSettingsOpen(false);
gameDialog.addEventListener("pointerdown",e=>{if(e.target===gameDialog)setGameSettingsOpen(false)});
addEventListener("keydown",e=>{if(e.key==="Escape"&&!gameDialog.hidden)setGameSettingsOpen(false)});
function saveGameSettings(){quality=gameControls.quality.value;targetFps=Number(gameControls.fps.value);mouseMode=gameControls.mouse.value;touchMode=gameControls.touch.value;keyboardMode=gameControls.keyboard.value;qualityLowFrames=0;qualityHighFrames=0;updateQuality();resize();for(const [k,v] of Object.entries({nf_quality:quality,nf_fps_cap:String(targetFps),nf_mouse_mode:mouseMode,nf_touch_mode:touchMode,nf_keyboard_mode:keyboardMode}))try{localStorage.setItem(k,v)}catch{}syncGameSettings();}
Object.values(gameControls).forEach(c=>c.addEventListener("change",saveGameSettings));
document.getElementById("gameSettingsReset").onclick=()=>{gameControls.quality.value="auto";gameControls.fps.value="60";gameControls.mouse.value="click";gameControls.touch.value="tap";gameControls.keyboard.value="wasd";saveGameSettings();};
if(settings){document.getElementById("qualitySelect").addEventListener("change",syncGameSettings);document.getElementById("fpsSelect").addEventListener("change",syncGameSettings);}
syncGameSettings();
updateQuality();connect();requestAnimationFrame(loop);
})();