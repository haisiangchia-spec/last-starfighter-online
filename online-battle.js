import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,onAuthStateChanged,signInAnonymously} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore,doc,getDoc,setDoc,writeBatch,onSnapshot,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
const $=id=>document.getElementById(id),room=(new URLSearchParams(location.hash.slice(1))).get('room')?.toUpperCase();
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
let uid,role,state,unsubscribe,locked=false,previousState=null,animation=null,swarmPlans={},selectedSwarm='SW-01',mapZoom=1,inspectedSide=null;
// Axial hex facings clockwise, matching the existing local game's directional convention.
const dirs=[[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]];
const moves=['hold','F','L','R'];
function parsePlan(plan){if(typeof plan!=='string'||!/^[FLR]{0,5}$/.test(plan))throw Error('Movement must contain 0–5 F/L/R steps.');if([...plan].filter(x=>x!=='F').length>3)throw Error('Maximum three turns per round.');return [...plan]}
function moveLimit(s){return Math.max(0,5-Math.max(Math.floor((s.engine||0)/2),Math.floor((s.hull||0)/4)))}
function turnLimit(s){return Math.max(0,3-Math.max(Math.floor((s.engine||0)/4),Math.floor((s.hull||0)/8)))}
function predict(ship,plan){const s={...ship};const steps=parsePlan(plan);if(steps.length>moveLimit(s))throw Error('Engine damage limits movement to '+moveLimit(s)+' steps.');if(steps.filter(x=>x!=='F').length>turnLimit(s))throw Error('System damage limits turns to '+turnLimit(s)+'.');if((s.pilot||0)>=6&&steps.length)throw Error('Pilot incapacitated.');for(const cmd of steps){const [dq,dr]=dirs[s.d];s.q+=dq;s.r+=dr;if(cmd==='L')s.d=(s.d+5)%6;if(cmd==='R')s.d=(s.d+1)%6;if(s.q<0||s.q>8||s.r<0||s.r>8)throw Error('Movement would leave the tactical map.')}return s}
const facingNames=['E','SE','SW','W','NW','NE'];
function facingToTarget(a,b){const dq=b.q-a.q,dr=b.r-a.r;let best=0,score=-Infinity;for(let i=0;i<6;i++){const [x,y]=dirs[i],v=(2*x+y)*dq+(x+2*y)*dr;if(v>score){score=v;best=i}}return best}
function inArc(a,b){const t=facingToTarget(a,b);return ((t-a.d+6)%6)<=1||((a.d-t+6)%6)<=1}

const asteroidHexes=[[3,2],[4,3],[5,5],[3,6],[5,1],[6,6]];const rockKey=(q,r)=>q+','+r;const rocksFor=s=>new Set((s?.asteroids||[]).map(p=>rockKey(p[0],p[1])));
function hexLine(a,b){const n=distance(a,b),line=[];for(let i=1;i<n;i++){const t=i/n,x=a.q+(b.q-a.q)*t,z=a.r+(b.r-a.r)*t,y=-x-z;let q=Math.round(x),r=Math.round(z),cy=Math.round(y);const dx=Math.abs(q-x),dy=Math.abs(cy-y),dz=Math.abs(r-z);if(dx>dy&&dx>dz)q=-cy-r;else if(dy>dz)cy=-q-r;else r=-q-cy;line.push([q,r])}return line}
function blocked(a,b,rocks){return hexLine(a,b).some(([q,r])=>rocks.has(rockKey(q,r)))}
const initial=(asteroids=false)=>({asteroids:asteroids?asteroidHexes:[],turn:1,ships:{host:{q:1,r:4,d:0,hp:20,power:20,missiles:4,engine:0,aim:0,hull:0,pilot:0,gunner:0,laserLoss:0,particleLost:false,missileLost:false,dead:false},guest:{q:7,r:4,d:3,hp:20,power:20,missiles:4,engine:0,aim:0,hull:0,pilot:0,gunner:0,laserLoss:0,particleLost:false,missileLost:false,dead:false}},submitted:{host:false,guest:false},phase:'orders',log:['Skirmish initiated. Both pilots must submit orders.'],winner:null});

// Swarm mode keeps a single Gunstar under host control and fourteen individual
// Ko-Dan contacts under guest control. Each contact has its own sealed vector.
const isSwarm=s=>s?.scenario==='swarm';
const swarmIds=()=>Array.from({length:14},(_,i)=>'SW-'+String(i+1).padStart(2,'0'));
const newSwarmShip=(i)=>({q:5+Math.floor(i/7)*2,r:1+(i%7),d:3,hp:20,power:20,missiles:0,engine:0,aim:0,hull:0,pilot:0,gunner:0,laserLoss:0,particleLost:true,missileLost:true,dead:false});
function initialSwarm(asteroids=false){
 const s=initial(asteroids);s.scenario='swarm';s.ships.host={...s.ships.host,q:1,r:4,d:0};
 s.ships.guest=newSwarmShip(0);s.fleet=Object.fromEntries(swarmIds().map((id,i)=>[id,newSwarmShip(i)]));
 s.log=['SWARM MISSION: Gunstar versus fourteen Ko-Dan contacts. Guest plots each surviving fighter.'];
 return s;
}
function enemyContacts(s,side){if(!isSwarm(s))return [s.ships[side==='host'?'guest':'host']];return side==='host'?Object.values(s.fleet||{}).filter(v=>!v.dead):[s.ships.host]}
function activeFleet(s){return Object.entries(s.fleet||{}).filter(([,ship])=>!ship.dead)}

const battleRef=()=>doc(db,'rooms',room,'combat','state');
const orderRef=(turn,side)=>doc(db,'rooms',room,'combatOrders',`${turn}_${side}`);
function note(msg){$('status').textContent=msg}
function distance(a,b){return(Math.abs(a.q-b.q)+Math.abs(a.r-b.r)+Math.abs((a.q+a.r)-(b.q+b.r)))/2}
// The damage matrix and subsystem thresholds are adapted directly from game.html.
const damageRows=[['F1','F1','F1','E1','E1','P1'],['F2,W','F2,R','F2,S','E1,N','E1,H','P2'],['F3','F3','F3','E2','E2','P4'],['F4,W','F4,R','F4,S','E2,N','E2,H','P6'],['F5,W','F5,R','F5,S','E3,N','E3,H','P8'],['F1,X','F1,T','F1,L','E3,P10','K','D']];
function roll(seed){let x=(seed>>>0)||1;x^=x<<13;x^=x>>>17;x^=x<<5;return 1+(x>>>0)%6}
function damageShip(ship,kind,turn,side,events,collisionTable=null){const salt=side==='host'?19:47;const red=roll(turn*1009+salt),white=roll(turn*3001+salt),table=collisionTable??Math.max(1,Math.min(6,red+(kind==='particle'?1:kind==='missile'?-1:0))),code=damageRows[table-1][white-1];events.push(`${side==='host'?'STAR LEAGUE':'KO-DAN'} DAMAGE RED ${red} WHITE ${white}: ${code}`);for(const part of code.split(',')){const c=part[0],n=Number(part.slice(1))||1;if(c==='F')ship.hull=(ship.hull||0)+n;if(c==='E')ship.engine=(ship.engine||0)+n;if(c==='P')ship.power=Math.max(0,(ship.power??20)-n);if(c==='T')ship.aim=(ship.aim||0)+1;if(c==='W')ship.pilot=(ship.pilot||0)+1;if(c==='K')ship.pilot=6;if(c==='D')ship.dead=true;if(c==='X'){const z=roll(turn*511+salt);if(z<=2)ship.laserLoss=(ship.laserLoss||0)+1;else if(z<=4)ship.particleLost=true;else ship.missileLost=true}if(c==='L')ship.life=ship.life||6;if('RSHN'.includes(c)){ship.pendingEffects=[...(ship.pendingEffects||[]),c]}}ship.hp=Math.max(0,20-(ship.hull||0));if((ship.hull||0)>=20||(ship.engine||0)>=10||(ship.pilot||0)>=6)ship.dead=true;if(ship.dead)ship.hp=0}
function apply(s,orders){
 const out=structuredClone(s),events=[`TURN ${s.turn}`];
 if(isSwarm(s))return applySwarm(s,orders);
 for(const side of ['host','guest']){
  const ship=out.ships[side],o=orders[side],plan=o.plan??(o.move==='hold'?'':o.move);
  try{const next=predict(ship,plan);Object.assign(ship,next);events.push(`${side==='host'?'STAR LEAGUE':'KO-DAN'} VECTOR ${plan||'HOLD'} · FACING ${ship.d}`);
   // Check each traversed asteroid hex, including intermediate hexes.
   const rocks=rocksFor(out),steps=[...parsePlan(plan)],walker={...s.ships[side]};
   for(let i=0;i<steps.length;i++){const [dq,dr]=dirs[walker.d];walker.q+=dq;walker.r+=dr;if(steps[i]==='L')walker.d=(walker.d+5)%6;if(steps[i]==='R')walker.d=(walker.d+1)%6;
    if(!rocks.has(rockKey(walker.q,walker.r)))continue;
    const salt=side==='host'?17:43,d1=roll(s.turn*977+salt+i*97),d2=roll(s.turn*1877+salt+i*131);
    events.push((side==='host'?'STAR LEAGUE':'KO-DAN')+' ASTEROID MANOEUVRE HEX '+walker.q+','+walker.r+': 2D6 '+d1+'+'+d2+'='+ (d1+d2)+' VS 6 '+(d1+d2<6?'COLLISION':'CLEAR'));
    if(d1+d2<6){damageShip(ship,'collision',s.turn+i*19,side,events,Math.max(1,Math.min(5,steps.length)));if(ship.dead)break}
   }
  }
  catch(e){events.push(`${side==='host'?'STAR LEAGUE':'KO-DAN'} INVALID VECTOR: HOLDS POSITION`)}
 }

 // All volleys use post-movement positions, with damage applied only after both sides fire.
 const hits={host:[],guest:[]},shots=[],weaponData={laser:{range:10,base:3},particle:{range:9,base:4},missile:{range:8,base:5}};
 function dice(turn,side,kind,index){let x=(turn*2654435761+(side==='host'?101:307)+kind.split('').reduce((a,c)=>a+c.charCodeAt(0),0)+index*7331)>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;return [1+(x>>>0)%6,1+((x>>>9)%6)]}
 function arcAllows(ship,enemy,arc){const relative=(facingToTarget(ship,enemy)-ship.d+6)%6;return ({0:[5,0,1],1:[0,1,2],5:[4,5,0],3:[2,3,4]})[arc]?.includes(relative)===true}
 for(const side of ['host','guest']){
  const ship=out.ships[side],enemySide=side==='host'?'guest':'host',enemy=out.ships[enemySide],o=orders[side],label=side==='host'?'STAR LEAGUE':'KO-DAN';
  const selection=o.fire||'laser';
  if(selection==='guard'){if((o.plan||'').length){events.push(label+' RECHARGE REQUIRES HOLD POSITION');continue}ship.power=Math.min(20,(ship.power??20)+5);events.push(label+' RECHARGES +5 POWER');continue}
  const kinds=selection.split('+').filter(k=>weaponData[k]);
  if(!kinds.length){events.push(label+' HOLDS FIRE');continue}
  const cap=Math.max(1,3-Math.max(Math.floor((ship.engine||0)/4),Math.floor((ship.hull||0)/8)));
  const enabled=kinds.slice(0,cap);
  if(kinds.length>cap)events.push(label+' SYSTEM DAMAGE: ONLY '+cap+' WEAPON GROUPS POWERED');
  if((ship.power??20)<1){events.push(label+' INSUFFICIENT POWER');continue}
  // Local game charges one point for an active turn, not one point per weapon.
  ship.power=Math.max(0,ship.power-1);
  let shotIndex=0;
  for(const kind of enabled){
   if(kind==='particle'&&ship.particleLost||kind==='missile'&&ship.missileLost){events.push(label+' '+kind.toUpperCase()+' OFFLINE');continue}
   if(kind==='missile'&&(ship.missiles??4)<1){events.push(label+' OUT OF MISSILES');continue}
   const n=kind==='laser'?Math.max(0,(side==='host'?2:3)-(ship.laserLoss||0)):1;
   for(let i=0;i<n;i++){
    const arc=kind!=='laser'?0:side==='host'?Number(o.arc??0):i===2?3:0;
    const range=distance(ship,enemy),rocks=rocksFor(out);
    if(blocked(ship,enemy,rocks)){events.push(label+' '+kind.toUpperCase()+' '+(i+1)+': ASTEROID BLOCKS LINE OF SIGHT');continue}
    if(range>weaponData[kind].range||!arcAllows(ship,enemy,arc)){events.push(label+' '+kind.toUpperCase()+' '+(i+1)+': NO FIRING SOLUTION ('+range+' HEXES / ARC)');continue}
    const [d1,d2]=dice(s.turn,side,kind,shotIndex++),target=weaponData[kind].base+Math.max(1,range)-1+Math.min(4,Math.max(ship.aim||0,Math.floor((ship.engine||0)/2),Math.floor((ship.hull||0)/4)))+((orders[enemySide].plan||'').length?0:-1)+(rocks.has(rockKey(ship.q,ship.r))?1:0)+(rocks.has(rockKey(enemy.q,enemy.r))?1:0),hit=d1+d2>=target;
    shots.push({side,kind,hit,from:{q:ship.q,r:ship.r},to:{q:enemy.q,r:enemy.r}});
    if(hit)hits[enemySide].push(kind);
    events.push(label+' '+kind.toUpperCase()+' '+(i+1)+' 2D6 '+d1+'+'+d2+'='+ (d1+d2)+' VS '+target+': '+(hit?'HIT':'MISS'));
    if(kind==='missile')ship.missiles--;
   }
  }
 }
 for(const side of ['host','guest'])for(let i=0;i<hits[side].length;i++)damageShip(out.ships[side],hits[side][i],s.turn+i*17,side,events);
 const a=out.ships.host,b=out.ships.guest;
 out.winner=a.dead&&b.dead?'DRAW':a.dead?'KO-DAN':b.dead?'STAR LEAGUE':null;
 out.lastVolley={turn:s.turn,shots};out.turn++;out.phase=out.winner?'finished':'orders';out.submitted={host:false,guest:false};
 out.log=[...events,...s.log].slice(0,90);if(out.winner)out.log.unshift(`BATTLE OVER: ${out.winner}`);
 return out;
}

function applySwarm(s,orders){
 const out=structuredClone(s),events=['TURN '+s.turn+' / SWARM'],shots=[],rocks=rocksFor(out);
 const gun=out.ships.host,guest=orders.guest,host=orders.host;
 function travel(ship,plan,id,side){
  try{const next=predict(ship,plan||'');Object.assign(ship,next);events.push(id+' VECTOR '+(plan||'HOLD'));
   const walker={...ship}; // Collision checks are resolved on the plotted route below.
  }catch(e){events.push(id+' INVALID VECTOR: '+e.message)}
 }
 travel(gun,host.plan,'GS-01','host');
 for(const [id,ship] of activeFleet(out))travel(ship,guest.fleetPlans?.[id]||'',id,'guest');
 const targets=activeFleet(out).map(([id,ship])=>({id,ship}));
 function shoot(attacker,defender,id,kind,index,side,arc=0){
  if(attacker.dead||defender.dead)return;
  const range=distance(attacker,defender),max=kind==='laser'?10:kind==='particle'?9:8;
  if(range>max||blocked(attacker,defender,rocks)||!arcAllowsSwarm(attacker,defender,arc))return;
  const base=kind==='laser'?(side==='guest'?4:3):kind==='particle'?4:5;
  const a=roll(s.turn*733+index*79+(side==='host'?17:41)),b=roll(s.turn*1181+index*103+(side==='host'?23:53));
  const target=base+range-1+Math.min(4,attacker.aim||0),hit=a+b>=target;
  shots.push({side,kind,hit,from:{q:attacker.q,r:attacker.r},to:{q:defender.q,r:defender.r}});
  events.push(id+' '+kind.toUpperCase()+' → '+(side==='host'?targets.find(x=>x.ship===defender)?.id||'SW':'GS-01')+': '+a+'+'+b+' VS '+target+' '+(hit?'HIT':'MISS'));
  if(hit)damageShip(defender,side==='guest'?'laser':kind,s.turn+index*31,side==='host'?'guest':'host',events);
 }
 const gunFire=host.fire==='guard'?[]:(host.fire||'laser').split('+');
 if(host.fire==='guard'&&!(host.plan||'').length){gun.power=Math.min(20,gun.power+5);events.push('GS-01 RECHARGES +5')}
 else if(gun.power>0&&!gun.dead){
  gun.power--;
  let idx=0;
  for(const kind of gunFire){if(kind==='missile'&&(!gun.missiles||gun.missileLost)||kind==='particle'&&gun.particleLost)continue;
   const n=kind==='laser'?Math.max(0,2-(gun.laserLoss||0)):1;
   for(let i=0;i<n;i++){const available=targets.filter(t=>!t.ship.dead&&distance(gun,t.ship)<=(kind==='laser'?10:kind==='particle'?9:8)&&!blocked(gun,t.ship,rocks)&&arcAllowsSwarm(gun,t.ship,kind==='laser'?Number(host.arc??0):0));if(!available.length)break;
    available.sort((a,b)=>distance(gun,a.ship)-distance(gun,b.ship));shoot(gun,available[0].ship,'GS-01',kind,idx++,'host',kind==='laser'?Number(host.arc??0):0);
    if(kind==='missile')gun.missiles--;
   }
  }
 }
 // Guest commands one laser volley per surviving swarm fighter.
 let i=0;
 for(const [id,ship] of activeFleet(out)){
  if(ship.power<=0)continue;
  ship.power=Math.max(0,ship.power-1);
  shoot(ship,gun,id,'laser',i++,'guest',0);
 }
 out.winner=gun.dead?'KO-DAN':activeFleet(out).length===0?'STAR LEAGUE':null;
 out.lastVolley={turn:s.turn,shots};out.turn++;out.phase=out.winner?'finished':'orders';out.submitted={host:false,guest:false};
 out.log=[...(out.winner?['BATTLE OVER: '+out.winner]:[]),...events,...s.log].slice(0,120);
 return out;
}
function arcAllowsSwarm(ship,enemy,arc){const relative=(facingToTarget(ship,enemy)-ship.d+6)%6;return ({0:[5,0,1],1:[0,1,2],5:[4,5,0],3:[2,3,4]})[arc]?.includes(relative)===true}

let visualEffects=null;function draw(positions=null){const c=$('map'),ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);const R=28*mapZoom,OX=100+(1-mapZoom)*310,OY=48+(1-mapZoom)*205;const point=(q,r)=>[OX+R*Math.sqrt(3)*(q+r/2),OY+R*1.5*r];for(let q=0;q<9;q++)for(let r=0;r<9;r++){const [x,y]=point(q,r);ctx.beginPath();for(let i=0;i<6;i++){const a=Math.PI/180*(60*i-30),px=x+R*Math.cos(a),py=y+R*Math.sin(a);i?ctx.lineTo(px,py):ctx.moveTo(px,py)}ctx.closePath();ctx.strokeStyle='#1e4d63';ctx.stroke()}if(!state)return;for(const [q,r] of (state.asteroids||[])){const [x,y]=point(q,r);ctx.save();ctx.translate(x,y);ctx.beginPath();ctx.moveTo(-16,-9);ctx.lineTo(-7,-19);ctx.lineTo(11,-15);ctx.lineTo(20,-1);ctx.lineTo(10,16);ctx.lineTo(-12,14);ctx.closePath();ctx.fillStyle='#61472f';ctx.strokeStyle='#ffc65b';ctx.lineWidth=1.7;ctx.shadowColor='#d5964c';ctx.shadowBlur=9;ctx.fill();ctx.stroke();ctx.restore()}for(const side of ['host','guest']){if(side==='guest'&&isSwarm(state))continue;const sh=state.ships[side],pos=positions?.[side]||sh,[x,y]=point(pos.q,pos.r);const color=side==='host'?'#52f5ff':'#ff667d';ctx.save();ctx.translate(x,y);ctx.rotate((pos.d??(side==='host'?0:3))*Math.PI/3);ctx.shadowColor=color;ctx.shadowBlur=13;ctx.beginPath();ctx.moveTo(R*.68,0);ctx.lineTo(-R*.43,-R*.43);ctx.lineTo(-R*.22,0);ctx.lineTo(-R*.43,R*.43);ctx.closePath();ctx.fillStyle=side==='host'?'#1a768c':'#922b4c';ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=1.8;ctx.stroke();ctx.restore();ctx.fillStyle=color;ctx.font='bold 12px monospace';ctx.textAlign='center';ctx.fillText(side==='host'?'GS-01':'DF-01',x,y-R*.78);ctx.font='11px monospace';ctx.fillText(`${sh.hp}/20`,x,y+R*.95);ctx.textAlign='left'}if(isSwarm(state)){for(const [id,sh] of Object.entries(state.fleet||{})){if(sh.dead)continue;const pos=positions?.[id]||sh,[x,y]=point(pos.q,pos.r);ctx.save();ctx.translate(x,y);ctx.rotate((pos.d||0)*Math.PI/3);ctx.beginPath();ctx.moveTo(15,0);ctx.lineTo(-11,-9);ctx.lineTo(-7,0);ctx.lineTo(-11,9);ctx.closePath();ctx.fillStyle='#922b4c';ctx.strokeStyle='#ff667d';ctx.lineWidth=1.5;ctx.fill();ctx.stroke();ctx.restore();ctx.fillStyle='#ff9aaa';ctx.font='10px monospace';ctx.textAlign='center';ctx.fillText(id,x,y-18);ctx.textAlign='left'}}if(visualEffects){const {shots,progress}=visualEffects;const shotCount=shots.length;const P=(q,r)=>[OX+R*Math.sqrt(3)*(q+r/2),OY+R*1.5*r];for(const [shotIndex,shot] of shots.entries()){const shotProgress=Math.min(1,Math.max(0,progress*shotCount-shotIndex));if(shotProgress<=0||shotProgress>=1)continue;const [ax,ay]=P(shot.from.q,shot.from.r),[bx,by]=P(shot.to.q,shot.to.r),dx=bx-ax,dy=by-ay,dist=Math.hypot(dx,dy)||1,nx=-dy/dist,ny=dx/dist,offset=shot.hit?0:Math.min(32,dist*.16),tx=bx+nx*offset,ty=by+ny*offset,color=shot.kind==='laser'?'#55f7ff':shot.kind==='particle'?'#ffc65b':'#ff5c77';ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=22;if(shot.kind==='missile'){const t=Math.min(1,Math.max(0,(shotProgress-.05)/.75));const x=ax+(tx-ax)*t,y=ay+(ty-ay)*t;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(x,y);ctx.stroke();ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill()}else if(shotProgress<.78){ctx.globalAlpha=shot.kind==='laser'?(Math.sin(shotProgress*70)>-.3?1:.25):.85;ctx.lineWidth=shot.kind==='particle'?6:3;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(tx,ty);ctx.stroke()}if(shot.hit&&shotProgress>.72){ctx.globalAlpha=Math.max(0,1-(shotProgress-.72)/.28);ctx.beginPath();ctx.arc(bx,by,7+(shotProgress-.72)*65,0,Math.PI*2);ctx.strokeStyle='#fff1b6';ctx.lineWidth=3;ctx.stroke()}ctx.restore()}} }
function animateTurn(before,after){
 if(animation)cancelAnimationFrame(animation);
 visualEffects=null;
 const start=performance.now(),moveDuration=650,fireDuration=2400,shots=after.lastVolley?.turn===before.turn?(after.lastVolley.shots||[]):[];
 function frame(now){
  const elapsed=now-start;
  if(elapsed<moveDuration){
   const t=Math.min(1,elapsed/moveDuration),ease=t*t*(3-2*t),positions={};
   for(const side of ['host','guest']){if(side==='guest'&&isSwarm(after))continue;const a=before.ships[side],b=after.ships[side];positions[side]={q:a.q+(b.q-a.q)*ease,r:a.r+(b.r-a.r)*ease,d:t<.5?a.d:b.d}}if(isSwarm(after))for(const [id,b] of Object.entries(after.fleet||{})){const a=before.fleet?.[id]||b;positions[id]={q:a.q+(b.q-a.q)*ease,r:a.r+(b.r-a.r)*ease,d:t<.5?a.d:b.d}}
   draw(positions);
  }else if(shots.length&&elapsed<moveDuration+fireDuration){
   visualEffects={shots,progress:Math.min(1,(elapsed-moveDuration)/fireDuration)};draw();
  }else{visualEffects=null;animation=null;draw();return}
  animation=requestAnimationFrame(frame);
 }
 animation=requestAnimationFrame(frame);
}
async function initialize(){if(!room||!/^[A-HJ-NP-Z2-9]{8}$/.test(room)){note('Missing room code. Create or join a room in the lobby first.');return}const rs=await getDoc(doc(db,'rooms',room));if(!rs.exists()){note('Room not found.');return}const r=rs.data();role=uid===r.hostUid?'host':uid===r.guestUid?'guest':null;if(!role){note('You are not a member of this room.');return}$('identity').textContent=`ROOM ${room} // ${role==='host'?'STAR LEAGUE':'KO-DAN'}`;if(!r.hostReady||!r.guestReady){note('Both pilots must mark ready in the lobby before combat.');return}if(role==='host')await runTransaction(db,async t=>{const s=await t.get(battleRef());if(!s.exists())t.set(battleRef(),r.scenario==='swarm'?initialSwarm(!!r.asteroids):initial(!!r.asteroids))});unsubscribe=onSnapshot(battleRef(),snap=>{if(!snap.exists()){note('Waiting for host to initialize skirmish...');return}const incoming=snap.data();const old=state;state=incoming;if(!old||incoming.turn!==old.turn||incoming.scenario!==old.scenario){swarmPlans={};selectedSwarm='SW-01';$('plan').value=''}if(old&&incoming.turn>old.turn){$('plan').value='';render();animateTurn(old,incoming)}else render()},e=>note(`SYNC ERROR: ${e.message}`))}
let lastTurn=0,autoAttemptTurn=0;function render(){if(!state||!role)return;if(lastTurn&&state.turn!==lastTurn){$('map').style.filter=''}lastTurn=state.turn;$('turn').textContent=state.turn;$('hull').textContent=`${state.ships[role].hp}/20`;$('log').textContent=state.log.join('\n');const swarmGuest=isSwarm(state)&&role==='guest';const self=swarmGuest?(state.fleet?.[selectedSwarm]||activeFleet(state)[0]?.[1]||state.ships.guest):state.ships[role],enemy=state.ships[role==='host'?'guest':'host'],inspect=(!isSwarm(state)&&inspectedSide)?state.ships[inspectedSide]:self;$('swarmControls').hidden=!swarmGuest;$('swarmScenario').textContent=isSwarm(state)?'SWARM: 14 CONTACTS':'DUEL: 1v1';if(swarmGuest){const options=activeFleet(state).map(([id])=>id);if(!options.includes(selectedSwarm))selectedSwarm=options[0]||'SW-01';$('swarmShip').innerHTML=options.map(id=>'<option value="'+id+'">'+id+' · '+(state.fleet[id].hp||0)+' HP</option>').join('');$('swarmShip').value=selectedSwarm;$('swarmCount').textContent=options.length+' fighters remaining · '+Object.keys(swarmPlans).length+' vectors stored';}else $('swarmCount').textContent=isSwarm(state)?activeFleet(state).length+' enemies remaining':'';$('heading').textContent=facingNames[self.d??0]+' ('+((self.d??0)*60)+'°)';$('range').textContent=distance(self,enemy)+' hexes';$('target').textContent=blocked(self,enemy,rocksFor(state))?'BLOCKED BY ASTEROID':inArc(self,enemy)?'IN FORWARD ARC':'OUTSIDE ARC';$('enemyHull').textContent=isSwarm(state)&&role==='host'?activeFleet(state).length+' FIGHTERS':enemy.hp+'/20';$('power').textContent=(inspect.power??20)+'/20';$('missiles').textContent=self.missiles??4;$('shipName').textContent=inspectedSide&&!isSwarm(state)?(inspectedSide==='host'?'GUNSTAR GS-01':'DECK FIGHTER DF-01'):swarmGuest?selectedSwarm:role==='host'?'GUNSTAR GS-01':'DECK FIGHTER DF-01';$('shipFaction').textContent=(inspectedSide||role)==='host'?'STAR LEAGUE':'KO-DAN';$('arc').disabled=role==='guest';for(const k of ['laser','particle','missile'])$(k).disabled=swarmGuest;$('powerBar').style.width=(Math.max(0,Math.min(20,self.power??20))/20*100)+'%';$('hullBar').style.width=(Math.max(0,Math.min(20,self.hull||0))/20*100)+'%';$('weaponDetail').innerHTML='<div class="telemetry-line"><span>LASERS</span><span>'+Math.max(0,((inspectedSide||role)==='host'?2:3)-(inspect.laserLoss||0))+' READY</span></div><div class="telemetry-line"><span>PARTICLE CANNON</span><span>'+(inspect.particleLost?'OFFLINE':'READY')+'</span></div><div class="telemetry-line"><span>MISSILE LAUNCHER</span><span>'+(inspect.missileLost?'OFFLINE':'READY')+'</span></div>';$('crewDetail').innerHTML='<div class="telemetry-line"><span>PILOT</span><span>'+(inspect.pilot||0)+'/6</span></div><div class="telemetry-line"><span>GUNNER</span><span>'+(inspect.gunner||0)+'/6</span></div><div class="telemetry-line"><span>PENDING EFFECTS</span><span>'+((inspect.pendingEffects||[]).join(', ')||'NONE')+'</span></div>';$('damage').textContent=`HULL ${inspect.hull||0}/20 · ENGINE ${inspect.engine||0}/10 · AIM +${inspect.aim||0} · PILOT ${inspect.pilot||0}/6`;$('targetPenalty').textContent='+'+(inspect.aim||0);$('systems').textContent=Math.max(1,3-Math.max(Math.floor((inspect.engine||0)/4),Math.floor((inspect.hull||0)/8)));$('crew').textContent='PILOT '+(inspect.pilot||0)+'/6 · GUNNER '+(inspect.gunner||0)+'/6';$('flightDetail').innerHTML='<div class="telemetry-line"><span>STEERING</span><span>'+(inspect.pilot>=6?'INCAPACITATED':'NORMAL')+'</span></div><div class="telemetry-line"><span>ENGINE DAMAGE</span><span>'+(inspect.engine||0)+'/10</span></div><div class="telemetry-line"><span>TURN ALLOWANCE</span><span>'+turnLimit(inspect)+'</span></div>';$('moveLimit').textContent=moveLimit(self)+' steps / '+turnLimit(self)+' turns';$('hostOrder').textContent=state.submitted.host?'SEALED':'PLANNING';$('guestOrder').textContent=state.submitted.guest?'SEALED':'PLANNING';try{const p=$('plan').value.trim().toUpperCase();const preview=predict(self,p);$('preview').textContent=`END HEX ${preview.q},${preview.r} · ${facingNames[preview.d]}`}catch(e){$('preview').textContent='INVALID VECTOR: '+e.message}$('moveChips').innerHTML=[...$('plan').value.toUpperCase()].map((m,i)=>'<span class="chip">'+(i+1)+': '+({F:'↑ FWD',L:'↖ LEFT',R:'↗ RIGHT'}[m]||'?')+'</span>').join('')||'<span class="muted">HOLD POSITION</span>';const both=state.submitted.host&&state.submitted.guest;if(both&&!locked&&!state.winner&&autoAttemptTurn!==state.turn){autoAttemptTurn=state.turn;setTimeout(()=>resolveTurn(),role==='host'?300:2500)}note(state.winner?`BATTLE COMPLETE: ${state.winner}`:both?'BOTH ORDERS SUBMITTED — resolving automatically.':state.submitted[role]?'ORDERS SEALED — waiting for opponent.':`AWAITING ORDERS — ${state.submitted[role==='host'?'guest':'host']?'opponent has submitted':'both pilots preparing'}`);$('submit').disabled=locked||!!state.winner||state.submitted[role];$('resolve').disabled=locked||!!state.winner||!both;$('reset').disabled=locked||role!=='host';draw()}
$('submit').onclick=async()=>{if(!state||locked||state.submitted[role])return;locked=true;render();try{const batch=writeBatch(db);const plan=$('plan').value.trim().toUpperCase();const swarmGuest=isSwarm(state)&&role==='guest';if(swarmGuest){predict(state.fleet[selectedSwarm],plan);swarmPlans[selectedSwarm]=plan;for(const [id,ship] of activeFleet(state))predict(ship,swarmPlans[id]||'')}else predict(state.ships[role],plan);batch.set(orderRef(state.turn,role),{owner:uid,turn:state.turn,plan:swarmGuest?'':plan,fire:swarmGuest?'laser':chosenWeapons(),arc:Number($('arc').value),fleetPlans:swarmGuest?swarmPlans:{}});batch.update(battleRef(),{[`submitted.${role}`]:true});await batch.commit()}catch(e){locked=false;render();note(`ORDER ERROR: ${e.message}`);return}finally{locked=false}};
async function resolveTurn(){if(!state||locked||!state.submitted.host||!state.submitted.guest)return;locked=true;render();try{const turn=state.turn;const [h,g]=await Promise.all([getDoc(orderRef(turn,'host')),getDoc(orderRef(turn,'guest'))]);if(!h.exists()||!g.exists())throw Error('Both order documents not yet visible.');const orders={host:h.data(),guest:g.data()};if(orders.host.owner===orders.guest.owner)throw Error('Invalid opponent identity.');await runTransaction(db,async t=>{const snap=await t.get(battleRef());const s=snap.data();if(s.turn!==turn||!s.submitted.host||!s.submitted.guest)return;t.set(battleRef(),apply(s,orders))})}catch(e){autoAttemptTurn=0;locked=false;render();note(`RESOLUTION ERROR: ${e.message}`);return}finally{locked=false;render()}}
$('resolve').onclick=resolveTurn;
$('reset').onclick=async()=>{if(role!=='host'||!confirm('Start a new skirmish for both players?'))return;try{await setDoc(battleRef(),isSwarm(state)?initialSwarm((state.asteroids||[]).length>0):initial((state.asteroids||[]).length>0))}catch(e){note(`RESET ERROR: ${e.message}`)}};
$('swarmShip').onchange=()=>{swarmPlans[selectedSwarm]=$('plan').value.trim().toUpperCase();selectedSwarm=$('swarmShip').value;$('plan').value=swarmPlans[selectedSwarm]||'';refreshPreview()};
$('saveSwarmPlan').onclick=()=>{if(!isSwarm(state)||role!=='guest')return;try{predict(state.fleet[selectedSwarm],$('plan').value.trim().toUpperCase());swarmPlans[selectedSwarm]=$('plan').value.trim().toUpperCase();const available=activeFleet(state).map(([id])=>id);selectedSwarm=available[(available.indexOf(selectedSwarm)+1)%available.length];$('plan').value=swarmPlans[selectedSwarm]||'';render()}catch(e){note('VECTOR ERROR: '+e.message)}};
function chosenWeapons(){const names=['laser','particle','missile'].filter(k=>$(k).checked);return names.length?names.join('+'):'guard'}
$('recharge').onclick=()=>{if(!state||state.submitted[role])return;$('plan').value='';for(const k of ['laser','particle','missile'])$(k).checked=false;refreshPreview();note('RECHARGE SELECTED — HOLD POSITION AND COMMIT TURN')};
for(const k of ['laser','particle','missile'])$(k).addEventListener('change',()=>{if(!['laser','particle','missile'].some(x=>$(x).checked))note('NO WEAPONS SELECTED — STATIONARY COMMIT WILL RECHARGE')});
$('zoomIn').onclick=()=>{mapZoom=Math.min(1.8,mapZoom+.15);draw()};$('zoomOut').onclick=()=>{mapZoom=Math.max(.6,mapZoom-.15);draw()};$('center').onclick=()=>{mapZoom=1;draw()};$('help').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();
$('map').onclick=e=>{if(!state||isSwarm(state))return;const bounds=$('map').getBoundingClientRect(),x=(e.clientX-bounds.left)*$('map').width/bounds.width,y=(e.clientY-bounds.top)*$('map').height/bounds.height,R=28*mapZoom,OX=100+(1-mapZoom)*310,OY=48+(1-mapZoom)*205;let best=null,dist=Infinity;for(const side of ['host','guest']){const sh=state.ships[side],px=OX+R*Math.sqrt(3)*(sh.q+sh.r/2),py=OY+R*1.5*sh.r,d=Math.hypot(x-px,y-py);if(d<dist){dist=d;best=side}}if(dist<R*1.2){inspectedSide=inspectedSide===best?null:best;render()}};
function refreshPreview(){$('moveChips').innerHTML=[...$('plan').value.toUpperCase()].map((m,i)=>'<span class="chip">'+(i+1)+': '+({F:'↑ FWD',L:'↖ LEFT',R:'↗ RIGHT'}[m]||'?')+'</span>').join('')||'<span class="muted">HOLD POSITION</span>';if(!state||!role)return;const self=isSwarm(state)&&role==='guest'?(state.fleet?.[selectedSwarm]||state.ships.guest):state.ships[role];try{const p=$('plan').value.toUpperCase();const v=predict(self,p);$('preview').textContent='END HEX '+v.q+','+v.r+' · '+facingNames[v.d]}catch(e){$('preview').textContent='INVALID VECTOR: '+e.message}}
$('plan').addEventListener('input',refreshPreview);
for(const cmd of ['F','L','R'])$('add'+cmd).onclick=()=>{if($('plan').value.length>=5)return;$('plan').value+=cmd;refreshPreview();$('plan').focus()};
$('undoPlan').onclick=()=>{$('plan').value=$('plan').value.slice(0,-1);refreshPreview()};
$('clearPlan').onclick=()=>{$('plan').value='';refreshPreview()};

$('copyBattleReport').onclick=()=>{const report=(state?.log||[]).join('\n');if(navigator.clipboard?.writeText)navigator.clipboard.writeText(report).then(()=>note('Combat report copied.')).catch(e=>note('Copy failed: '+e.message));else note('Clipboard unavailable in this browser.')};
onAuthStateChanged(auth,async u=>{if(!u){try{await signInAnonymously(auth)}catch(e){note(`AUTH ERROR: ${e.message}`)}return}uid=u.uid;try{await initialize()}catch(e){note(`INIT ERROR: ${e.message}`)}});
