import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
const $=id=>document.getElementById(id);
let auth,db,uid=null,room=null,role=null,unsubscribe=null,current=null;
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(){const b=new Uint8Array(8);crypto.getRandomValues(b);return Array.from(b,n=>alphabet[n%alphabet.length]).join('')}
function notice(msg){$('notice').textContent=msg}
function error(e){console.error(e);notice('ERROR: '+(e?.message||String(e)))}
const slots=['host','guest','host2','guest2'];
const slotUid=(r,slot)=>r[slot==='host'?'hostUid':slot==='guest'?'guestUid':slot+'Uid'];
const slotReady=(r,slot)=>!!r[slot==='host'?'hostReady':slot==='guest'?'guestReady':slot+'Ready'];
const sideOf=slot=>slot.startsWith('host')?'STAR LEAGUE':'KO-DAN';
const team=(r,side)=>slots.filter(slot=>slot.startsWith(side)&&!!slotUid(r,slot));
const balanced=r=>{const h=team(r,'host'),g=team(r,'guest');return h.length===g.length&&h.length>0&&h.every(x=>slotReady(r,x))&&g.every(x=>slotReady(r,x))};
function show(r){
 current=r;
 const host=team(r,'host'),guest=team(r,'guest'),equal=host.length===guest.length&&host.length>0,ready=balanced(r);
 $('scenarioSettings').hidden=role!=='host';
 $('scenarioChoice').value=r.scenario||'duel';$('lobbyAsteroids').checked=!!r.asteroids;
 $('scenarioStatus').textContent=(r.scenario==='swarm'?'KO-DAN SWARM (EXPERIMENTAL)':'GUNSTAR DUEL')+(r.asteroids?' · ASTEROIDS':' · CLEAR SPACE');
 $('launch').disabled=!ready;
 $('roomPanel').hidden=false;$('roomCode').textContent=room;
 $('side').textContent=sideOf(role)+' · '+(role.endsWith('2')?'PILOT 2':'PILOT 1');
 $('hostState').textContent=host.map(slot=>(slot==='host'?'P1':'P2')+': '+(slotReady(r,slot)?'READY':'WAITING')).join(' · ')||'AWAITING PILOT';
 $('guestState').textContent=guest.map(slot=>(slot==='guest'?'P1':'P2')+': '+(slotReady(r,slot)?'READY':'WAITING')).join(' · ')||'AWAITING PILOT';
 $('balanceState').textContent=host.length+' vs '+guest.length+(equal?' · BALANCED':' · UNEVEN — LAUNCH BLOCKED');
 $('balanceState').className=equal?'ok':'wait';
 $('sessionState').textContent=ready?'ALL PILOTS READY · LAUNCH ENABLED':!equal?'WAITING FOR EQUAL TEAM SIZES':'WAITING FOR ALL PILOTS TO READY';
 $('ready').textContent=slotReady(r,role)?'CANCEL READY':'MARK READY';$('ready').disabled=false;
}
function subscribe(code){unsubscribe?.();room=code;unsubscribe=onSnapshot(doc(db,'rooms',room),snap=>{
 if(!snap.exists()){notice('Room no longer exists.');return}
 const data=snap.data();role=slots.find(slot=>slotUid(data,slot)===uid);
 if(!role){notice('You are not a member of this room.');return}
 show(data);notice('Connected to room '+room+'. Lobby updates are live.');
},error)}
async function createRoom(){if(!uid)return;try{
 $('create').disabled=true;let code;for(let i=0;i<5;i++){code=randomCode();if(!(await getDoc(doc(db,'rooms',code))).exists())break;}
 await setDoc(doc(db,'rooms',code),{hostUid:uid,guestUid:null,host2Uid:null,guest2Uid:null,hostReady:false,guestReady:false,host2Ready:false,guest2Ready:false,createdAt:serverTimestamp(),scenario:'duel',asteroids:false});
 subscribe(code);history.replaceState(null,'','#room='+code);
}catch(e){error(e)}finally{$('create').disabled=false}}
async function joinRoom(code){if(!uid)return;code=code.toUpperCase().trim();
 if(!/^[A-HJ-NP-Z2-9]{8}$/.test(code)){notice('Enter a valid 8-character room code.');return}
 try{
 const ref=doc(db,'rooms',code),snap=await getDoc(ref);
 if(!snap.exists()){notice('Room not found.');return}
 const r=snap.data();
 if(slots.some(slot=>slotUid(r,slot)===uid)){subscribe(code);history.replaceState(null,'','#room='+code);return}
 const faction=$('joinFaction').value;
 const slot=await runTransaction(db,async tx=>{
  const current=await tx.get(ref);if(!current.exists())throw Error('Room not found');
  const data=current.data();
  if(slots.some(x=>slotUid(data,x)===uid))return slots.find(x=>slotUid(data,x)===uid);
  const available=(faction==='host'?['host','host2']:['guest','guest2']).find(x=>!slotUid(data,x));
  if(!available)throw Error('This faction already has two pilots.');
  const field=available==='host'?'hostUid':available==='guest'?'guestUid':available+'Uid';
  tx.update(ref,{[field]:uid});
  return available;
 });
 subscribe(code);history.replaceState(null,'','#room='+code);
 }catch(e){error(e)}
}
$('saveScenario').onclick=async()=>{if(role!=='host'||!room||!current)return;try{
 await updateDoc(doc(db,'rooms',room),{scenario:$('scenarioChoice').value,asteroids:$('lobbyAsteroids').checked,hostReady:false,guestReady:false,host2Ready:false,guest2Ready:false});
 notice('Mission settings saved. All pilots must ready up again.');
}catch(e){error(e)}};
$('create').onclick=createRoom;$('join').onclick=()=>joinRoom($('codeInput').value);
$('launch').onclick=()=>{if(!current||!balanced(current)){notice('Launch blocked: equal teams and all pilots ready required.');return}location.href='./online-battle.html#room='+room};
$('ready').onclick=async()=>{if(!room||!role||!current)return;try{
 const field=role+'Ready';
 await updateDoc(doc(db,'rooms',room),{[field]:!slotReady(current,role)});
}catch(e){error(e)}};
$('copy').onclick=async()=>{const url=new URL(location.href);url.hash='room='+room;try{await navigator.clipboard.writeText(url.toString());notice('Invitation link copied.')}catch{notice('Share this URL: '+url.toString())}};
$('leave').onclick=()=>{unsubscribe?.();unsubscribe=null;room=null;role=null;current=null;$('roomPanel').hidden=true;history.replaceState(null,'',location.pathname);notice('Left room view. Your room membership remains reserved so you can reconnect using the same browser.')} ;
if(!firebaseConfig.apiKey||firebaseConfig.apiKey==='REPLACE_ME'||firebaseConfig.projectId==='REPLACE_ME'){$('authStatus').textContent='Firebase configuration required';$('setupHint').hidden=false;notice('Follow SETUP.md to configure the Firebase project.')}else{try{const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);onAuthStateChanged(auth,async user=>{if(!user){try{await signInAnonymously(auth)}catch(e){error(e)}return}uid=user.uid;$('authStatus').textContent='CONNECTED · ANONYMOUS PILOT';$('create').disabled=false;$('join').disabled=false;const match=location.hash.match(/room=([A-HJ-NP-Z2-9]{8})/i);if(match&&!room)await joinRoom(match[1]);});}catch(e){error(e)}}
