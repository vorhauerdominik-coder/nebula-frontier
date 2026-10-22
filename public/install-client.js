(()=>{
 let pending=null;
 const authButton=document.getElementById('installClient');
 const lobbyButton=document.getElementById('lobbyInstallClient');
 const hint=document.getElementById('installClientHint');
 const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 const info=()=>{
   if(standalone()){if(authButton)authButton.hidden=true;if(lobbyButton)lobbyButton.hidden=true;return;}
   if(authButton)authButton.hidden=false;
 };
 const showHint=message=>{if(hint){hint.textContent=message;hint.hidden=false;}else alert(message);};
 async function install(){
  if(standalone()){showHint('Nebula Frontier ist bereits installiert.');return;}
  if(pending){const ev=pending;pending=null;ev.prompt();await ev.userChoice;return;}
  const ua=navigator.userAgent;
  if(/iPad|iPhone|iPod/.test(ua))showHint('iPhone/iPad: In Safari Teilen → Zum Home-Bildschirm.');
  else if(/Android/.test(ua))showHint('Android: Browsermenü ⋮ → App installieren oder Zum Startbildschirm hinzufügen.');
  else showHint('PC: In Chrome/Edge über das Installieren-Symbol in der Adressleiste installieren. Alternativ den Desktop-Client aus dem Projekt bauen.');
 }
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();pending=e;info();});
 window.addEventListener('appinstalled',()=>{pending=null;info();});
 authButton?.addEventListener('click',install);
 lobbyButton?.addEventListener('click',install);
 if('serviceWorker' in navigator&&location.protocol==='https:')window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));
 info();
})();
