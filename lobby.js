import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, onSnapshot, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
const $=id=>document.getElementById(id);
let auth,db,uid=null,room=null,role=null,unsubscribe=null,current=null;
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomSeed(){const seed=new Uint32Array(1);crypto.getRandomValues(seed);return seed[0]||1}
function coinFlip(){const b=new Uint32Array(1);crypto.getRandomValues(b);return (b[0]&1)===0}
function pilotName(){const value=$('pilotName').value.trim().replace(/\s+/g,' ');if(!value||value.length>24)throw Error('Enter your pilot name (1–24 characters) before creating or joining a room.');return value}
const slotName=(r,slot)=>r[slot+'Name']||'UNNAMED PILOT';
const isRoomOwner=r=>!!r&&(r.ownerUid===uid||(!r.ownerUid&&r.hostUid===uid));
function availableSlot(r){
 const h=team(r,'host').length,g=team(r,'guest').length;
 const preferred=h<g?'host':g<h?'guest':coinFlip()?'host':'guest';
 for(const faction of [preferred,preferred==='host'?'guest':'host']){
  const open=(faction==='host'?['host','host2']:['guest','guest2']).find(slot=>!slotUid(r,slot));
  if(open)return open;
 }
 return null;
}
function randomCode(){const b=new Uint8Array(8);crypto.getRandomValues(b);return Array.from(b,n=>alphabet[n%alphabet.length]).join('')}
function notice(msg){$('notice').textContent=msg}
function error(e){console.error(e);notice('ERROR: '+(e?.message||String(e)))}
const slots=['host','guest','host2','guest2'];
const slotUid=(r,slot)=>r[slot==='host'?'hostUid':slot==='guest'?'guestUid':slot+'Uid'];
const slotReady=(r,slot)=>!!r[slot==='host'?'hostReady':slot==='guest'?'guestReady':slot+'Ready'];
const sideOf=slot=>slot.startsWith('host')?'FEDERATION / STAR LEAGUE':'KO-DAN';
const team=(r,side)=>slots.filter(slot=>slot.startsWith(side)&&!!slotUid(r,slot));
const launchBlockers=r=>{const h=team(r,'host'),g=team(r,'guest'),missing=[];if(!h.length||!g.length||h.length!==g.length)missing.push('NEED EQUAL TEAMS (CURRENTLY '+h.length+' VS '+g.length+')');if(r.scenario==='swarm')missing.push('SWARM IS VS COMPUTER ONLY · SELECT DUEL');for(const slot of [...h,...g])if(!slotReady(r,slot))missing.push((slot==='host'?'GS-01':slot==='host2'?'GS-02':slot==='guest'?'DF-01':'DF-02')+' NOT READY');return missing};
const balanced=r=>launchBlockers(r).length===0;
function show(r){
 current=r;
 const host=team(r,'host'),guest=team(r,'guest'),equal=host.length===guest.length&&host.length>0,blockers=launchBlockers(r),ready=blockers.length===0;
 $('scenarioSettings').hidden=!isRoomOwner(r);
 $('scenarioChoice').value=r.scenario||'duel';$('lobbyAsteroids').checked=!!r.asteroids;$('battleSeed').value=String(currentSeed(r));
 $('seedStatus').textContent=String(currentSeed(r));
 $('scenarioStatus').textContent=('GUNSTAR DUEL')+(r.asteroids?' · ASTEROIDS':' · CLEAR SPACE');
 $('launch').disabled=!ready;$('launch').textContent=ready?'LAUNCH ONLINE BATTLE · READY':'LAUNCH LOCKED · '+(equal?'WAITING FOR READY':'UNEVEN TEAMS');$('launch').title=ready?'All pilots ready to launch':blockers.join(' · ');$('launchHint').textContent=ready?'✓ ALL PILOTS READY · 1v1 OR 2v2 MISSION CAN START':'LAUNCH REQUIREMENTS: '+blockers.join(' · ');$('launchHint').className=ready?'ok':'wait';
 $('roomPanel').hidden=false;$('roomCode').textContent=room;
 $('side').textContent=slotName(r,role)+' · '+sideOf(role)+' · '+(role.endsWith('2')?'PILOT 2':'PILOT 1')+(isRoomOwner(r)?' · ROOM CREATOR':'');
 $('hostState').textContent=host.map(slot=>(slot==='host'?'P1':'P2')+' '+slotName(r,slot)+': '+(slotReady(r,slot)?'READY':'WAITING')).join(' · ')||'AWAITING PILOT';
 $('guestState').textContent=guest.map(slot=>(slot==='guest'?'P1':'P2')+' '+slotName(r,slot)+': '+(slotReady(r,slot)?'READY':'WAITING')).join(' · ')||'AWAITING PILOT';
 $('balanceState').textContent=host.length+' vs '+guest.length+(equal?' · BALANCED':' · UNEVEN — LAUNCH BLOCKED');
 $('balanceState').className=equal?'ok':'wait';
 $('sessionState').textContent=ready?'ALL PILOTS READY · LAUNCH ENABLED':blockers.join(' · ');
 $('ready').textContent=slotReady(r,role)?'CANCEL READY':'MARK READY';$('ready').disabled=false;
}
function subscribe(code){unsubscribe?.();room=code;unsubscribe=onSnapshot(doc(db,'rooms',room),snap=>{
 if(!snap.exists()){notice('Room no longer exists.');return}
 const data=snap.data();role=slots.find(slot=>slotUid(data,slot)===uid);
 if(!role){notice('You are not a member of this room.');return}
 show(data);notice('Connected to room '+room+'. Lobby updates are live.');
},error)}
async function createRoom(){if(!uid)return;
 let name;try{name=pilotName()}catch(e){notice(e.message);return}
 try{
  $('create').disabled=true;
  let code;for(let i=0;i<8;i++){code=randomCode();if(!(await getDoc(doc(db,'rooms',code))).exists())break}
  const firstSide=coinFlip()?'host':'guest';
  const data={ownerUid:uid,hostUid:firstSide==='host'?uid:null,guestUid:firstSide==='guest'?uid:null,host2Uid:null,guest2Uid:null,hostName:firstSide==='host'?name:null,guestName:firstSide==='guest'?name:null,host2Name:null,guest2Name:null,hostReady:false,guestReady:false,host2Ready:false,guest2Ready:false,createdAt:serverTimestamp(),scenario:'duel',asteroids:true,seed:randomSeed()};
  await setDoc(doc(db,'rooms',code),data);
  localStorage.setItem('starfighterPilotName',name);
  subscribe(code);history.replaceState(null,'','#room='+code);
 }catch(e){error(e)}finally{$('create').disabled=false}
}
async function joinRoom(code){if(!uid)return;code=code.toUpperCase().trim();
 if(!/^[A-HJ-NP-Z2-9]{8}$/.test(code)){notice('Enter a valid 8-character room code.');return}
 try{
  const ref=doc(db,'rooms',code),snap=await getDoc(ref);
  if(!snap.exists()){notice('Room not found.');return}
  const r=snap.data();
  if(slots.some(slot=>slotUid(r,slot)===uid)){subscribe(code);history.replaceState(null,'','#room='+code);return}
  let name;try{name=pilotName()}catch(e){notice(e.message);return}
  await runTransaction(db,async tx=>{
   const current=await tx.get(ref);if(!current.exists())throw Error('Room not found');
   const data=current.data();
   if(slots.some(x=>slotUid(data,x)===uid))return;
   const available=availableSlot(data);
   if(!available)throw Error('Room is full (four pilots).');
   const field=available==='host'?'hostUid':available==='guest'?'guestUid':available+'Uid';
   tx.update(ref,{[field]:uid,[available+'Name']:name});
  });
  localStorage.setItem('starfighterPilotName',name);
  subscribe(code);history.replaceState(null,'','#room='+code);
 }catch(e){error(e)}
}
const currentSeed=r=>Number.isInteger(r?.seed)&&r.seed>=1&&r.seed<=4294967295?r.seed:1984;
async function saveScenario(){
 if(!isRoomOwner(current)||!room||!current)return;
 const button=$('saveScenario');button.disabled=true;
 try{
  const asteroid=$('lobbyAsteroids').checked,scenario='duel',seed=Number($('battleSeed').value);
  if(!Number.isSafeInteger(seed)||seed<1||seed>4294967295)throw Error('Seed must be a whole number between 1 and 4294967295.');
  await updateDoc(doc(db,'rooms',room),{scenario,asteroids:asteroid,seed,hostReady:false,guestReady:false,host2Ready:false,guest2Ready:false});
  notice('SAVED: '+(asteroid?'ASTEROID FIELD ENABLED':'CLEAR SPACE')+' · SEED '+seed+'. All pilots must ready up again.');
 }catch(e){error(e);$('lobbyAsteroids').checked=!!current.asteroids;$('battleSeed').value=String(currentSeed(current))}
 finally{button.disabled=false}
}
$('saveScenario').onclick=saveScenario;
$('lobbyAsteroids').addEventListener('change',saveScenario);
$('scenarioChoice').addEventListener('change',saveScenario);
$('battleSeed').addEventListener('change',saveScenario);
$('randomSeed').addEventListener('click',()=>{$('battleSeed').value=String(randomSeed());saveScenario()});
$('pilotName').value=localStorage.getItem('starfighterPilotName')||'';
$('create').onclick=createRoom;$('join').onclick=()=>joinRoom($('codeInput').value);
$('launch').onclick=()=>{if(!current||!balanced(current)){notice('Launch blocked: '+(current?launchBlockers(current).join(' · '):'ROOM NOT LOADED'));return}location.href='./online-battle.html#room='+room};
$('ready').onclick=async()=>{if(!room||!role||!current)return;try{
 const field=role+'Ready';
 await updateDoc(doc(db,'rooms',room),{[field]:!slotReady(current,role)});
}catch(e){error(e)}};
$('copy').onclick=async()=>{const url=new URL(location.href);url.hash='room='+room;try{await navigator.clipboard.writeText(url.toString());notice('Invitation link copied.')}catch{notice('Share this URL: '+url.toString())}};
$('leave').onclick=()=>{unsubscribe?.();unsubscribe=null;room=null;role=null;current=null;$('roomPanel').hidden=true;history.replaceState(null,'',location.pathname);notice('Left room view. Your room membership remains reserved so you can reconnect using the same browser.')} ;
if(!firebaseConfig.apiKey||firebaseConfig.apiKey==='REPLACE_ME'||firebaseConfig.projectId==='REPLACE_ME'){$('authStatus').textContent='Firebase configuration required';$('setupHint').hidden=false;notice('Follow SETUP.md to configure the Firebase project.')}else{try{const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);if(location.hostname==='127.0.0.1'&&new URLSearchParams(location.search).has('emulator')){connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8080)}onAuthStateChanged(auth,async user=>{if(!user){try{await signInAnonymously(auth)}catch(e){error(e)}return}uid=user.uid;$('authStatus').textContent='CONNECTED · ANONYMOUS PILOT';$('create').disabled=false;$('join').disabled=false;const match=location.hash.match(/room=([A-HJ-NP-Z2-9]{8})/i);if(match&&!room)await joinRoom(match[1]);});}catch(e){error(e)}}
