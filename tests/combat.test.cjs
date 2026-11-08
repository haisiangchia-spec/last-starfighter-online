// Run: node --test tests/combat.test.cjs
// Loads the actual production combat engine, excluding Firebase/browser wiring.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../online-battle.js'),'utf8');
const start=source.indexOf('const dirs=');
const end=source.indexOf('let visualEffects=null');
assert.ok(start>=0&&end>start,'Combat engine source boundaries changed');
const engine=source.slice(start,end);
const sandbox={structuredClone,console};
vm.createContext(sandbox);
vm.runInContext(engine+'\nthis.combat={initial,initialDoubles,initialSwarm,apply,applyDoubles,asteroidCollision,missileBlast,rocksFor,damageShip,roll,damageRows,crewThreshold,crewInjuryCheck,recoverCrewOnline,hexLine,firingBlocked,facingToTarget,weaponTargets,declaredTarget,prepareTemporaryOnline,endTurnDamageOnline,predict,moveLimit,turnLimit,fireControlCrewReason,usableWeaponKinds,weaponTargets,availableAsteroidTargets,parseAsteroidTarget};',sandbox,{filename:'online-battle.js'});
const c=sandbox.combat;
const orders=(host={plan:'',fire:'none'},guest={plan:'',fire:'none'})=>({host,guest});
function scenario(){const s=c.initial(false);s.log=[];return s}
test('damage matrix is six by six and matches printed FASA rows',()=>{
 assert.equal(c.damageRows.length,6);
 assert.ok(c.damageRows.every(row=>row.length===6));
 assert.equal(c.damageRows[5][5],'D');
 assert.equal(c.damageRows[1][0],'F2,W');
});
test('missile and particle modifiers use different damage tables',()=>{
 const a=scenario().ships.host,b=scenario().ships.host;
 const la=[],pa=[];
 c.damageShip(a,'missile',12,'host',la);
 c.damageShip(b,'particle',12,'host',pa);
 assert.match(la[0],/TABLE [1-6]/);
 assert.match(pa[0],/TABLE [1-6]/);
 const table=kind=>Math.max(1,Math.min(6,c.roll(12*1009+19)+(kind==='particle'?1:-1)));
 assert.equal(Number(la[0].match(/TABLE (\d)/)[1]),table('missile'));
 assert.equal(Number(pa[0].match(/TABLE (\d)/)[1]),table('particle'));
});
test('simultaneous lethal hull failures end in a draw',()=>{
 const s=scenario();s.ships.host.hull=20;s.ships.guest.hull=20;s.ships.host.dead=true;s.ships.guest.dead=true;
 const result=c.apply(s,orders());
 assert.equal(result.winner,'DRAW');
 assert.equal(result.phase,'finished');
});
test('stationary no-fire turn does not consume power',()=>{
 const s=scenario(),next=c.apply(s,orders());
 assert.equal(next.ships.host.power,20);
 assert.equal(next.ships.guest.power,20);
});
test('explicit recharge restores up to power cap',()=>{
 const s=scenario();s.ships.host.power=18;
 const next=c.apply(s,orders({plan:'',fire:'guard'}));
 assert.equal(next.ships.host.power,20);
});
test('missile blast is eligible to hit friendly ship within one hex',()=>{
 const s=scenario();
 s.ships.host={...s.ships.host,q:8,r:6,d:0};
 s.ships.guest={...s.ships.guest,q:9,r:6,d:3};
 let confirmed=null;
 for(let turn=1;turn<=120;turn++){
  s.turn=turn;
  const next=c.apply(s,orders({plan:'',fire:'missile'},{plan:'',fire:'none'}));
  if(next.lastVolley.shots.some(x=>x.side==='host'&&x.kind==='missile'&&x.hit)){confirmed=next;break}
 }
 assert.ok(confirmed,'Expected at least one confirmed missile hit within 120 deterministic turns');
 const blasts=confirmed.log.filter(x=>x.includes('MISSILE BLAST'));
 assert.equal(blasts.length,2,'Both adjacent ships must receive missile blast damage');
 assert.ok(blasts.some(x=>x.includes('STAR LEAGUE')));
 assert.ok(blasts.some(x=>x.includes('KO-DAN')));
});
test('crew injury thresholds match original',()=>{
 assert.equal(c.crewThreshold(2),0);
 assert.equal(c.crewThreshold(3),8);
 assert.equal(c.crewThreshold(4),10);
 assert.equal(c.crewThreshold(5),12);
});
test('unconscious pilot cannot move under submitted orders',()=>{
 const s=scenario();s.ships.host.unconsciousPilot=1;
 const next=c.apply(s,orders({plan:'FFF',fire:'none'}));
 assert.equal(next.ships.host.q,s.ships.host.q);
 assert.equal(next.ships.host.r,s.ships.host.r);
});
test('asteroid between ships blocks line of sight',()=>{
 const a={q:2,r:6},b={q:6,r:6};
 assert.equal(c.firingBlocked(a,b,new Set(['4,6'])),true);
 assert.equal(c.firingBlocked(a,b,new Set()),false);
});
test('same seed and orders resolve identically',()=>{
 const s=scenario(),o=orders({plan:'FF',fire:'laser'},{plan:'FF',fire:'laser'});
 assert.deepEqual(JSON.parse(JSON.stringify(c.apply(s,o))),JSON.parse(JSON.stringify(c.apply(s,o))));
});

test('two simultaneous hits resolve independently even when a ship is destroyed',()=>{
 const s=scenario();
 s.ships.host={...s.ships.host,q:8,r:6,d:0,hull:19};
 s.ships.guest={...s.ships.guest,q:9,r:6,d:3,hull:19};
 let resolved=null;
 for(let turn=1;turn<=120;turn++){
  s.turn=turn;
  const next=c.apply(s,orders({plan:'',fire:'laser'},{plan:'',fire:'laser'}));
  if(next.lastVolley.shots.some(x=>x.side==='host'&&x.hit)&&next.lastVolley.shots.some(x=>x.side==='guest'&&x.hit)){resolved=next;break}
 }
 assert.ok(resolved,'Expected a turn where both sides land laser hits');
 // A hit can damage engines, power, or crew instead of hull. Both
 // volleys must still resolve even if one ship suffers fatal damage.
 assert.ok(resolved.log.some(x=>x.includes('STAR LEAGUE DAMAGE')));
 assert.ok(resolved.log.some(x=>x.includes('KO-DAN DAMAGE')));
 assert.ok(resolved.lastVolley.shots.some(x=>x.side==='host'&&x.hit));
 assert.ok(resolved.lastVolley.shots.some(x=>x.side==='guest'&&x.hit));
});
test('newly injured crew misses the following turn and then receives recovery checks',()=>{
 const s=scenario();s.ships.host.pilot=4;s.ships.host.unconsciousPilot=2;
 const next=c.apply(s,orders());
 assert.equal(next.ships.host.unconsciousPilot,1);
 const following=c.apply(next,orders());
 assert.ok([0,1].includes(following.ships.host.unconsciousPilot));
});
test('damage rolls remain independent for multiple hits on same ship',()=>{
 const s=scenario();
 s.ships.host={...s.ships.host,q:8,r:6,d:0};
 s.ships.guest={...s.ships.guest,q:9,r:6,d:3};
 let found=null;
 for(let turn=1;turn<=120;turn++){
  s.turn=turn;
  const next=c.apply(s,orders({plan:'',fire:'laser'},{plan:'',fire:'none'}));
  if(next.lastVolley.shots.filter(x=>x.side==='host'&&x.hit).length===2){found=next;break}
 }
 assert.ok(found,'Expected a turn where both Gunstar lasers hit');
 const damage=found.log.filter(x=>x.includes('KO-DAN DAMAGE'));
 assert.equal(damage.length,2);
 const seed=found.turn-1;
 for(let i=0;i<2;i++){
  const rollSeed=seed*10000+5000+i*37+1;
  assert.ok(damage[i].includes('RED '+c.roll(rollSeed*1009+47)),'Each hit uses its own red die seed');
 }
});

test('finished matches are not silently reset on refresh',()=>{
 const init=source.slice(source.indexOf('async function initialize()'),source.indexOf('let lastTurn='));
 assert.match(init,/snap\.data\(\)\.phase==='ended'/);
 assert.doesNotMatch(init,/\['ended','finished'\]/);
});
test('guest redirects to lobby on host-ended snapshot regardless of cached ready flags',()=>{
 const init=source.slice(source.indexOf('async function initialize()'),source.indexOf('let lastTurn='));
 assert.match(init,/if\(incoming\.phase==='ended'\)\{location\.replace\('\.\/index\.html#room='\+room\);return\}/);
 assert.doesNotMatch(init,/Waiting for host to initialize rematch/);
});
test('constant speed orders require the exact permitted movement length',()=>{
 const ship=scenario().ships.host;
 ship.constant=3;
 const next=c.apply({...scenario(),ships:{...scenario().ships,host:ship}},orders({plan:'F',fire:'none'}));
 assert.equal(next.ships.host.q,ship.q);
 assert.ok(next.log.some(x=>x.includes('INVALID VECTOR')));
});

test('damage reports include system changes and printed table result',()=>{
 const ship=scenario().ships.host,events=[];
 c.damageShip(ship,'laser',23,'host',events);
 assert.ok(events.some(x=>x.includes('DAMAGE')&&x.includes('TABLE')));
 assert.ok(events.some(x=>x.includes('GS-01 DAMAGE RESULT:')));
});
test('multiplayer telemetry exposes all local ship damage and survival fields',()=>{
 const render=source.slice(source.indexOf('function render()'),source.indexOf("$('submit').onclick"));
 for(const label of ['LASER MOUNTS','PARTICLE CANNON','MISSILE RACK','PHOTON AMMO','FIRE CHANNELS','TARGETING','LIFE SUPPORT','NEXT-TURN DAMAGE','ASTEROID CHECKS','SPEED LOCK','STABILIZER','ENGINE DAMAGE','VECTOR SYSTEMS','HULL STATUS']){
  assert.ok(render.includes(label),'Missing local telemetry field: '+label);
 }
 assert.ok(render.includes('inspect.hull'),'Telemetry must display inspected ship hull');
});

test('original damage narration reports fuselage and engine effects',()=>{
 const ship=scenario().ships.host,events=[];
 c.damageShip(ship,'laser',23,'host',events);
 const result=events.find(x=>x.includes('GS-01 DAMAGE RESULT:'));
 assert.ok(result);
 if(ship.hull>0)assert.ok(events.some(x=>x.includes('GS-01 FUSELAGE +')));
 if(ship.engine>0)assert.ok(events.some(x=>x.includes('GS-01 ENGINE +')));
});
test('original combat log effect labels are retained',()=>{
 for(const label of ['FUSELAGE +','ENGINE +','TARGETING COMPUTER DAMAGED','STEERING RESTRICTION pending','STABILIZER DAMAGED','HALF SPEED restriction pending','NO SPEED CHANGE restriction pending','CREW HIT:','LIFE SUPPORT DAMAGED','WEAPON DESTROYED:','EXPLODES / REMOVED FROM ACTIVE PLAY']){
  assert.ok(source.includes(label),'Missing original combat narration: '+label);
 }
});

test('sealed orders show a clear opponent-specific waiting indicator',()=>{
 const render=source.slice(source.indexOf('function render()'),source.indexOf("$('submit').onclick"));
 assert.ok(render.includes('WAITING FOR ${doubles?pending.map(x=>x.toUpperCase()).join(\', \'):otherName} TO SUBMIT ORDERS'));
 assert.ok(render.includes('HAS LOCKED ORDERS · YOUR ORDERS STILL PENDING'));
 assert.ok(render.includes('ALL PILOTS READY — executing movement.'));
 assert.ok(render.includes('ALL TARGETS LOCKED — resolving weapon fire.'))
 assert.ok(render.includes("state.submitted[role]"));
 assert.ok(render.includes("state.submitted[other]"));
});

test('destroyed duel ships are skipped by the tactical map renderer',()=>{
 const draw=source.slice(source.indexOf('function draw('),source.indexOf('function animateTurn('));
 assert.match(draw,/const sh=state\.ships\[side\];if\(sh\.dead\)continue/);
});
test('victory defeat and draw banner is driven by synchronized winner state',()=>{
 assert.match(source,/function showBattleResult\(\)/);
 assert.match(source,/state\.phase==='finished'\|\|!!state\.winner/);
 assert.match(source,/VICTORY · /);
 assert.match(source,/DEFEAT · /);
 assert.match(source,/BATTLE ENDED IN A DRAW/);
 assert.match(source,/function render\(\)\{if\(!state\|\|!role\)return;showBattleResult\(\)/);
});

test('2v2 initializes four independently positioned ships and sealed slots',()=>{
 const s=c.initialDoubles(true);
 assert.deepEqual(Object.keys(s.ships).sort(),['guest','guest2','host','host2']);
 assert.deepEqual(Object.keys(s.submitted).sort(),['guest','guest2','host','host2']);
 assert.notEqual(s.ships.host.r,s.ships.host2.r);
 assert.notEqual(s.ships.guest.r,s.ships.guest2.r);
 assert.ok(s.asteroids.length>0);
});
test('2v2 movement orders apply independently to all four ships',()=>{
 const s=c.initialDoubles(false),o={};
 for(const slot of Object.keys(s.ships))o[slot]={plan:'',fire:'none',target:''};
 o.host2.plan='F';o.guest2.plan='F';
 const next=c.apply(s,o);
 assert.equal(next.ships.host.q,s.ships.host.q);
 assert.equal(next.ships.host2.q,s.ships.host2.q+1);
 assert.equal(next.ships.guest2.q,s.ships.guest2.q-1);
 assert.equal(next.turn,2);
 assert.deepEqual(Object.values(next.submitted),[false,false,false,false]);
});
test('2v2 winner requires elimination of both enemy fighters',()=>{
 const s=c.initialDoubles(false),o={};
 for(const slot of Object.keys(s.ships))o[slot]={plan:'',fire:'none',target:''};
 s.ships.guest.dead=true;s.ships.guest2.dead=false;
 assert.equal(c.apply(s,o).winner,null);
 s.ships.guest2.dead=true;
 assert.equal(c.apply(s,o).winner,'STAR LEAGUE');
});
test('2v2 combat uses explicit enemy target',()=>{
 const s=c.initialDoubles(false),o={};
 for(const slot of Object.keys(s.ships))o[slot]={plan:'',fire:'none',target:''};
 s.ships.host.q=8;s.ships.host.r=4;s.ships.host.d=0;
 s.ships.guest.q=9;s.ships.guest.r=4;
 s.ships.guest2.q=9;s.ships.guest2.r=5;
 o.host={plan:'',fire:'laser',arc:0,target:'guest2'};
 let fired=false;
 for(let turn=1;turn<=100;turn++){s.turn=turn;const next=c.apply(s,o);if(next.lastVolley.shots.some(x=>x.side==='host')){fired=true;assert.ok(next.log.some(x=>x.includes('HOST LASER → GUEST2')));break}}
 assert.ok(fired);
});

test('2v2 awards victory when both opposing pilots are killed',()=>{
 const battle=c.initialDoubles(false),orders={};
 for(const slot of Object.keys(battle.ships))orders[slot]={plan:'',fire:'none',target:''};
 battle.ships.guest.pilot=6;battle.ships.guest2.pilot=6;
 const next=c.apply(battle,orders);
 assert.equal(next.winner,'STAR LEAGUE');
 assert.equal(next.phase,'finished');
 assert.equal(next.ships.guest.dead,false);
 assert.equal(next.ships.guest2.dead,false);
});
test('2v2 defeat counts a destroyed ship and a killed pilot as elimination',()=>{
 const battle=c.initialDoubles(false),orders={};
 for(const slot of Object.keys(battle.ships))orders[slot]={plan:'',fire:'none',target:''};
 battle.ships.guest.dead=true;battle.ships.guest2.pilot=6;
 assert.equal(c.apply(battle,orders).winner,'STAR LEAGUE');
 battle.ships.guest2.dead=true;
 assert.equal(c.apply(battle,orders).winner,'STAR LEAGUE');
});
test('2v2 simultaneous destruction of both fleets produces draw',()=>{
 const battle=c.initialDoubles(false),orders={};
 for(const slot of Object.keys(battle.ships))orders[slot]={plan:'',fire:'none',target:''};
 for(const slot of Object.keys(battle.ships))battle.ships[slot].dead=true;
 const next=c.apply(battle,orders);
 assert.equal(next.winner,'DRAW');
 assert.equal(next.phase,'finished');
});

test('sealed order IDs are scoped to a unique match for rematches',()=>{
 assert.match(source,/const orderRef=\(turn,side,matchId=state\?\.matchId\)/);
 assert.match(source,/matchId:crypto\.randomUUID\(\)/);
});
test('2v2 shows four fleet statuses and does not end when only one ship is lost',()=>{
 assert.match(source,/fleetStatus/);
 assert.match(source,/const defeated=side=>battleSlots\.filter\(x=>teamSide\(x\)===side\)\.every\(x=>out\.ships\[x\]\.dead\|\|out\.ships\[x\]\.pilot>=6\)/);
});

test('asteroid check is identical for first pilots in 1v1 and 2v2',()=>{
 const a=c.initial(true),b=c.initialDoubles(true),orders1={host:{plan:'FFFF',fire:'none'},guest:{plan:'',fire:'none'}};
 const orders2={host:orders1.host,guest:orders1.guest,host2:{plan:'',fire:'none'},guest2:{plan:'',fire:'none'}};
 a.ships.host.q=5;a.ships.host.r=3;a.ships.host.d=0;
 b.ships.host.q=5;b.ships.host.r=3;b.ships.host.d=0;
 const x=c.apply(a,orders1),y=c.apply(b,orders2);
 assert.equal(x.ships.host.asteroidChecks,y.ships.host.asteroidChecks);
 assert.equal(x.ships.host.asteroidImpacts||0,y.ships.host.asteroidImpacts||0);
});
test('asteroid collision checks are performed once per entered rock hex and logged',()=>{
 const rocks=c.rocksFor(c.initial(true)),[q,r]=[...rocks][0].split(',').map(Number);
 const ship={...c.initial(false).ships.host,q,r},events=[];
 c.asteroidCollision(ship,rocks,1,'host',0,4,events);
 assert.equal(ship.asteroidChecks,1);
 assert.match(events[0],new RegExp('ASTEROID HEX '+q+','+r+': 2D6 .* VS 6'));
});
test('asteroid-free hex never triggers collision check',()=>{
 const ship={...c.initial(false).ships.host,q:0,r:0},events=[];
 assert.equal(c.asteroidCollision(ship,c.rocksFor(c.initial(true)),1,'host',0,3,events),false);
 assert.equal(events.length,0);
 assert.equal(ship.asteroidChecks,undefined);
});
test('missile splash hits every adjacent ship including friendlies in 2v2',()=>{
 const s=c.initialDoubles(false);
 s.ships.guest.q=8;s.ships.guest.r=6;
 s.ships.guest2.q=8;s.ships.guest2.r=7;
 s.ships.host.q=9;s.ships.host.r=6;
 s.ships.host2.q=3;s.ships.host2.r=3;
 const hits={host:[],guest:[],host2:[],guest2:[]},events=[];
 c.missileBlast(s,c.rocksFor(s),s.ships.guest,hits,events,'host2');
 assert.equal(hits.guest.length,1);
 assert.equal(hits.guest2.length,1);
 assert.equal(hits.host.length,1);
 assert.equal(hits.host2.length,0);
});
test('missile hitting an asteroid hex destroys rock and restricts blast to occupants',()=>{
 const s=c.initialDoubles(true);
 const [q,r]=s.asteroids[0].split(',').map(Number);
 s.ships.guest.q=q;s.ships.guest.r=r;
 s.ships.guest2.q=q;s.ships.guest2.r=r+1;
 s.ships.host.q=q;s.ships.host.r=r;
 const hits={host:[],guest:[],host2:[],guest2:[]},events=[],rocks=c.rocksFor(s);
 c.missileBlast(s,rocks,s.ships.guest,hits,events,'host2');
 assert.equal(hits.host.length,1);
 assert.equal(hits.guest.length,1);
 assert.equal(hits.guest2.length,0);
 assert.equal(rocks.has(q+','+r),false);
 assert.ok(!s.asteroids.some(p=>p===q+','+r));
 assert.match(events.join(' '),/ASTEROID DESTROYED/);
});
test('line-of-sight blocking applies in 2v2 as in 1v1',()=>{
 const a={q:5,r:3},b={q:9,r:3},rocks=c.rocksFor(c.initial(true));
 assert.equal(c.firingBlocked(a,b,rocks),true);
 assert.equal(c.firingBlocked(a,b,new Set()),false);
});

test('asteroid positions serialize to Firestore-safe primitives, never nested arrays',()=>{
 for(const scenario of [c.initial(true),c.initialDoubles(true)]){
  assert.ok(scenario.asteroids.length>0);
  assert.ok(scenario.asteroids.every(x=>typeof x==='string'&&/^[0-9]+,[0-9]+$/.test(x)));
  assert.ok(!scenario.asteroids.some(Array.isArray));
  assert.equal(c.rocksFor(scenario).size,scenario.asteroids.length);
 }
});

test('Firestore rules accept the same match-scoped order IDs generated by the client',()=>{
 const rules=fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8');
 assert.match(rules,/function idFor\(slot\) \{ return battle\(\)\.matchId/);
 assert.match(rules,/orderId == idFor\(side\(\)\)/);
 assert.match(rules,/orderId == idFor\(side\(\)\) \+ '_target'/);
 assert.match(rules,/request\.resource\.data\.phase in \['targeting','finished'\]/);
 assert.match(source,/\x60\$\{matchId\|\|'legacy'\}_\$\{turn\}_\$\{side\}\x60/);
});
test('both players render the same server-provided asteroid coordinates',()=>{
 assert.match(source,/const rocksFor=s=>new Set/);
 assert.doesNotMatch(source,/ctx\.fillText\(q\+'\,'\+r/);
 assert.match(source,/for\(const asteroid of \(state\.asteroids\|\|\[\]\)\)/);
});

test('online asteroid generation exactly follows the local 1984-seed 22-attempt algorithm',()=>{
 const s=c.initial(true);
 let rng=1984;const random=()=>{rng=(Math.imul(1664525,rng)+1013904223)>>>0;return rng/4294967296};
 const expected=new Set();
 for(let i=0;i<22;i++)expected.add((5+Math.floor(random()*9))+','+Math.floor(random()*13));
 assert.deepEqual([...s.asteroids],[...expected]);
 assert.equal(s.asteroids.length,20);
 assert.deepEqual([...c.initialDoubles(true).asteroids],[...expected]);
});

test('1v1 and 2v2 generate matching, Firestore-safe asteroid layouts for a chosen seed',()=>{
 for(const seed of [1,42,1984,2026,4294967295]){
  const a=c.initial(true,seed),b=c.initialDoubles(true,seed);
  assert.equal(a.seed,seed);assert.equal(b.seed,seed);
  assert.deepEqual(a.asteroids,b.asteroids);
  assert.ok(a.asteroids.every(x=>typeof x==='string'));
  assert.ok(a.asteroids.length<=22);
 }
 assert.notDeepEqual(c.initial(true,42).asteroids,c.initial(true,1984).asteroids);
});
test('battle seed is saved in room and validated by Firestore security rules',()=>{
 const rules=fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8');
 assert.match(rules,/request\.resource\.data\.seed is int/);
 assert.match(source,/const seed=Number\.isInteger\(r\.seed\)/);
});

test('online multiplayer forbids swarm while local AI can launch 1v14',()=>{
 const lobby=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const local=fs.readFileSync(path.join(__dirname,'../game.html'),'utf8');
 const rules=fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8');
 assert.doesNotMatch(lobby,/<option value="swarm">/);
 assert.match(lobby,/game\.html\?scenario=swarm&mode=ai/);
 assert.match(local,/launch\.get\('scenario'\)/);
 assert.match(rules,/request\.resource\.data\.scenario == 'duel'/);
 assert.match(source,/if\(r\.scenario==='swarm'\|\|hosts!==guests/);
});

test('local Swarm follows rulebook: no-asteroid ships face away; asteroid ships face Gunstar',()=>{
 const local=fs.readFileSync(path.join(__dirname,'../game.html'),'utf8');
 assert.match(local,/make\('GS-01','gunstar','star',5,6,0\)/);
 assert.match(local,/10\+2\*wave,r,0\)/);
 assert.match(local,/make\('GS-01','gunstar','star',0,6,0\)/);
 assert.match(local,/16\+2\*wave,r,3\)/);
 assert.doesNotMatch(local,/10\+2\*wave,r,3\)/);
});

test('three successive no-fire 1v1 turns preserve ship health and reset sealed flags',()=>{
 let state=c.initial(false);
 const start=JSON.parse(JSON.stringify(state.ships));
 for(let turn=1;turn<=3;turn++){
  state=c.apply(state,orders());
  assert.equal(state.turn,turn+1);
  assert.equal(state.phase,'orders');
  assert.equal(state.winner,null);
  assert.ok(Object.values(state.submitted).every(v=>v===false));
  for(const side of ['host','guest']){
   assert.equal(state.ships[side].hull,start[side].hull);
   assert.equal(state.ships[side].power,start[side].power);
   assert.equal(state.ships[side].dead,false);
  }
 }
});
test('three successive no-fire 2v2 turns preserve all four ships and independent slots',()=>{
 let state=c.initialDoubles(false);
 const start=JSON.parse(JSON.stringify(state.ships));
 const o=Object.fromEntries(Object.keys(state.ships).map(slot=>[slot,{plan:'',fire:'none',target:''}]));
 for(let turn=1;turn<=3;turn++){
  state=c.apply(state,o);
  assert.equal(state.turn,turn+1);
  assert.equal(state.phase,'orders');
  assert.equal(state.winner,null);
  assert.equal(Object.keys(state.submitted).length,4);
  assert.ok(Object.values(state.submitted).every(v=>v===false));
  for(const slot of Object.keys(start)){
   assert.equal(state.ships[slot].hull,start[slot].hull);
   assert.equal(state.ships[slot].power,start[slot].power);
   assert.equal(state.ships[slot].dead,false);
  }
 }
});

test('a powerless 1v1 ship cannot fire and cannot spend negative power',()=>{
 const state=scenario();
 state.ships.host.power=0;
 state.ships.host.q=8;state.ships.host.r=6;state.ships.host.d=0;
 state.ships.guest.q=9;state.ships.guest.r=6;state.ships.guest.d=3;
 const next=c.apply(state,orders({plan:'',fire:'laser'},{plan:'',fire:'none'}));
 assert.equal(next.ships.host.power,0);
 assert.ok(next.log.some(x=>x.includes('INSUFFICIENT POWER')));
 assert.ok(!next.lastVolley.shots.some(x=>x.side==='host'));
});
test('a powerless 2v2 ship cannot fire while the other pilots resolve their turn',()=>{
 const state=c.initialDoubles(false);
 state.ships.host.power=0;
 const o=Object.fromEntries(Object.keys(state.ships).map(slot=>[slot,{plan:'',fire:'none',target:''}]));
 o.host={plan:'',fire:'laser',target:'guest'};
 const next=c.apply(state,o);
 assert.equal(next.turn,2);
 assert.equal(next.ships.host.power,0);
 assert.ok(next.log.some(x=>x.includes('INSUFFICIENT POWER')));
 assert.ok(!next.lastVolley.shots.some(x=>x.side==='host'));
});
test('1v1 and 2v2 recharge never exceed maximum power',()=>{
 for(const doubles of [false,true]){
  const state=doubles?c.initialDoubles(false):scenario();
  state.ships.host.power=19;
  const o=doubles?Object.fromEntries(Object.keys(state.ships).map(slot=>[slot,{plan:'',fire:'none',target:''}])):orders();
  o.host={plan:'',fire:'guard'};
  const next=c.apply(state,o);
  assert.equal(next.ships.host.power,20);
  assert.ok(next.log.some(x=>x.includes('RECHARGES +5 POWER')));
 }
});

test('movement stage produces visible positions without firing or advancing the turn',()=>{
 const state=c.initialDoubles(false);
 const o=Object.fromEntries(Object.keys(state.ships).map(slot=>[slot,{plan:'F',fire:'laser',arc:0}]));
 const next=c.apply(state,o,'move');
 assert.equal(next.phase,'targeting');
 assert.equal(next.turn,1);
 assert.equal(next.ships.host.q,3);
 assert.equal(next.ships.guest.q,15);
 assert.equal(next.lastVolley,undefined);
 assert.ok(Object.values(next.submitted).every(x=>x===false));
 assert.equal(next.movementOrders.host.plan,'F');
});
test('target selection phase proposes easiest legal targets and allows splitting lasers',()=>{
 const s=c.initialDoubles(false);
 s.ships.host.q=8;s.ships.host.r=6;s.ships.host.d=0;
 s.ships.guest.q=9;s.ships.guest.r=6;s.ships.guest.d=3;
 s.ships.guest2.q=9;s.ships.guest2.r=7;s.ships.guest2.d=3;
 const targets=c.weaponTargets(s,'host','laser',0,0);
 assert.equal(targets.length,2);
 assert.equal(targets[0].id,'guest');
 assert.ok(targets.every(t=>t.range<=10));
 const o=Object.fromEntries(Object.keys(s.ships).map(slot=>[slot,{plan:'',fire:'none',arc:0}]));
 o.host={plan:'',fire:'laser',arc:0,targets:{laser1:'guest',laser2:'guest2'}};
 const outcome=c.apply(s,o,'fire');
 const gun=outcome.lastVolley.shots.filter(x=>x.side==='host'&&x.kind==='laser');
 assert.equal(gun.length,2);
 assert.deepEqual(Array.from(gun,x=>[x.to.q,x.to.r]),[[9,6],[9,7]]);
 assert.equal(outcome.turn,2);
});
test('explicit HOLD FIRE does not auto-switch to another target',()=>{
 const s=c.initialDoubles(false);
 s.ships.host.q=8;s.ships.host.r=6;s.ships.host.d=0;
 s.ships.guest.q=9;s.ships.guest.r=6;s.ships.guest2.q=9;s.ships.guest2.r=7;
 const o=Object.fromEntries(Object.keys(s.ships).map(slot=>[slot,{plan:'',fire:'none',arc:0}]));
 o.host={plan:'',fire:'laser',arc:0,targets:{laser1:'none',laser2:'guest2'}};
 const result=c.apply(s,o,'fire');
 assert.equal(result.lastVolley.shots.filter(x=>x.side==='host').length,1);
 assert.equal(result.lastVolley.shots.find(x=>x.side==='host').to.r,7);
});
test('Swarm movement and firing stages are separate and default targets are ranked',()=>{
 const s=c.initialSwarm(false);
 const o={host:{plan:'',fire:'laser',arc:0},guest:{plan:'',fire:'laser',fleetPlans:{}}};
 const moved=c.apply(s,o,'move');
 assert.equal(moved.phase,'targeting');assert.equal(moved.turn,1);
 const eligible=c.weaponTargets(moved,'host','laser',0,0);
 assert.ok(eligible.length>1);
 assert.ok(eligible.every((v,i,a)=>i===0||a[i-1].toHit<=v.toHit));
 const choice=eligible[eligible.length-1].id;
 const fired=c.apply(moved,{...o,host:{...o.host,targets:{laser1:choice,laser2:'none'}}},'fire');
 assert.equal(fired.turn,2);assert.equal(fired.phase,'orders');
 assert.ok(fired.lastVolley.shots.filter(x=>x.side==='host'&&x.kind==='laser').length<=1);
});

test('best-target picker includes targeting-system and engine damage in displayed hit threshold',()=>{
 const state=c.initialDoubles(false);
 state.ships.host.q=8;state.ships.host.r=6;state.ships.host.d=0;
 state.ships.host.engine=4;state.ships.host.aim=3;state.ships.host.hull=0;
 state.ships.guest.q=9;state.ships.guest.r=6;state.ships.guest.lastMove=1;
 state.ships.guest2.q=9;state.ships.guest2.r=7;state.ships.guest2.lastMove=0;
 const options=c.weaponTargets(state,'host','laser',0,0);
 assert.equal(options.length,2);
 // Range 1, base 3, targeting damage +3 => 6; target stationary receives -1.
 assert.equal(options.find(x=>x.id==='guest').toHit,6);
 // Range 2, base 3, targeting damage +3, stationary -1 => 6.
 assert.equal(options.find(x=>x.id==='guest2').toHit,6);
 assert.equal(options[0].id,'guest');
});
test('declared firing target is locked even when another target is a better shot',()=>{
 const state=c.initialDoubles(false);
 state.ships.host.q=8;state.ships.host.r=6;state.ships.host.d=0;
 state.ships.guest.q=9;state.ships.guest.r=6;
 state.ships.guest2.q=9;state.ships.guest2.r=7;
 const choices=c.weaponTargets(state,'host','laser',0,0);
 assert.equal(choices[0].id,'guest');
 const o=Object.fromEntries(Object.keys(state.ships).map(slot=>[slot,{plan:'',fire:'none',arc:0}]));
 o.host={plan:'',fire:'laser',arc:0,targets:{laser1:'guest2',laser2:'none'}};
 const resolved=c.apply(state,o,'fire');
 const shots=resolved.lastVolley.shots.filter(x=>x.side==='host');
 assert.equal(shots.length,1);
 assert.equal(shots[0].to.q,9);assert.equal(shots[0].to.r,7);
});

test('movement eliminates last 1v1 defender before targeting phase',()=>{
 const state=c.initial(false),o=orders();
 state.ships.guest.q=0;state.ships.guest.r=6;state.ships.guest.d=3;
 o.guest.plan='F';
 const after=c.apply(state,o,'move');
 assert.equal(after.phase,'finished');
 assert.equal(after.winner,'STAR LEAGUE');
 assert.equal(after.turn,1);
 assert.ok(after.log.some(x=>x.includes('BATTLE OVER DURING MOVEMENT')));
});
test('mutual off-map loss during movement ends in a draw without targeting',()=>{
 const state=c.initial(false),o=orders();
 state.ships.host.q=18;state.ships.host.r=6;state.ships.host.d=0;
 state.ships.guest.q=0;state.ships.guest.r=6;state.ships.guest.d=3;
 o.host.plan='F';o.guest.plan='F';
 const after=c.apply(state,o,'move');
 assert.equal(after.phase,'finished');
 assert.equal(after.winner,'DRAW');
});
test('all killed pilots count as defeat in the 2v2 victory check',()=>{
 const state=c.initialDoubles(false);
 state.ships.guest.pilot=6;state.ships.guest2.pilot=6;
 const o=Object.fromEntries(Object.keys(state.ships).map(slot=>[slot,{plan:'',fire:'none',arc:0}]));
 const ended=c.apply(state,o,'move');
 assert.equal(ended.phase,'finished');
 assert.equal(ended.winner,'STAR LEAGUE');
});

test('Firestore allows movement-only victory without forcing target declaration',()=>{
 const rules=fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8');
 assert.match(rules,/resource\.data\.phase == 'orders'[\s\S]*?request\.resource\.data\.phase in \['targeting','finished'\]/);
});

test('Swarm vessels fire one forward laser apiece',()=>{
 const battle=c.initialSwarm(false);
 battle.ships.host.q=8; battle.ships.host.r=6;
 for(const ship of Object.values(battle.fleet)){ship.q=9;ship.r=6;ship.d=3}
 const result=c.apply(battle,{host:{plan:'',fire:'none'},guest:{plan:'',fire:'laser',fleetPlans:{}}},'fire');
 const shots=result.lastVolley.shots.filter(x=>x.side==='guest'&&x.kind==='laser');
 assert.equal(shots.length,14);
});
test('Swarm ships with a lost laser cannot fire',()=>{
 const battle=c.initialSwarm(false);
 battle.ships.host.q=8; battle.ships.host.r=6;
 for(const ship of Object.values(battle.fleet)){ship.q=9;ship.r=6;ship.d=3}
 battle.fleet['SW-01'].laserLoss=1;
 const result=c.apply(battle,{host:{plan:'',fire:'none'},guest:{plan:'',fire:'laser',fleetPlans:{}}},'fire');
 assert.equal(result.lastVolley.shots.filter(x=>x.side==='guest').length,13);
});

test('a single successful laser hit destroys a Swarm Ship without a damage-table survival roll',()=>{
 const battle=c.initialSwarm(false);
 battle.ships.host.q=8;battle.ships.host.r=6;battle.ships.host.d=0;
 for(const [id,ship] of Object.entries(battle.fleet)){
  if(id!=='SW-01')ship.dead=true;
 }
 battle.fleet['SW-01'].q=9;battle.fleet['SW-01'].r=6;
 const fire={host:{plan:'',fire:'laser',arc:0,targets:{laser1:'SW-01',laser2:'none'}},guest:{plan:'',fire:'none',fleetPlans:{}}};
 let confirmed=false;
 for(let turn=1;turn<=25;turn++){
  battle.turn=turn;
  const outcome=c.apply(battle,fire,'fire');
  if(outcome.lastVolley.shots.some(shot=>shot.side==='host'&&shot.hit)){
   assert.equal(outcome.fleet['SW-01'].dead,true);
   assert.equal(outcome.fleet['SW-01'].hp,0);
   assert.ok(outcome.log.some(line=>line.includes('SW-01 DESTROYED')));
   confirmed=true;break;
  }
 }
 assert.ok(confirmed,'Expected a hit in 25 deterministic turns');
});

test('Swarm laser uses printed stationary-target bonus',()=>{
 const battle=c.initialSwarm(false);
 battle.ships.host.q=8;battle.ships.host.r=6;battle.ships.host.d=0;
 battle.ships.host.lastMove=0;
 for(const [id,ship] of Object.entries(battle.fleet)){
  if(id!=='SW-01')ship.dead=true;
 }
 battle.fleet['SW-01'].q=9;battle.fleet['SW-01'].r=6;battle.fleet['SW-01'].d=3;
 const result=c.apply(battle,{host:{plan:'',fire:'none'},guest:{plan:'',fire:'laser',fleetPlans:{}}},'fire');
 const line=result.log.find(x=>x.startsWith('SW-01 LASER → GS-01:'));
 assert.ok(line,'Swarm laser should fire from its forward arc');
 // Base 4 + zero range increment -1 for a stationary Gunstar = 3.
 assert.match(line,/VS 3 /);
});

test('Swarm craft are explicitly limited to three movement hexes',()=>{
 const s=c.initialSwarm(false);
 assert.equal(s.fleet['SW-01'].type,'swarm');
 assert.equal(s.fleet['SW-01'].q,10);
 const moves={host:{plan:'',fire:'none'},guest:{plan:'',fire:'none',fleetPlans:{'SW-01':'FFF'}}};
 const out=c.apply(s,moves,'move');
 assert.equal(out.fleet['SW-01'].q,13);
 assert.equal(out.fleet['SW-01'].lastMove,3);
});
test('Swarm craft cannot plot four moves while the Gunstar can',()=>{
 const s=c.initialSwarm(false);
 const moves={host:{plan:'FFFF',fire:'none'},guest:{plan:'',fire:'none',fleetPlans:{'SW-01':'FFFF'}}};
 const out=c.apply(s,moves,'move');
 assert.equal(out.ships.host.q,9);
 assert.equal(out.fleet['SW-01'].q,10);
 assert.equal(out.fleet['SW-01'].lastMove,0);
 assert.ok(out.log.some(line=>line.includes('SW-01 INVALID VECTOR')));
});

test('Swarm movement resolves ship IDs in order before the Gunstar',()=>{
 const battle=c.initialSwarm(false);
 const out=c.apply(battle,{host:{plan:'F',fire:'none'},guest:{plan:'',fire:'none',fleetPlans:{'SW-01':'F','SW-02':'F'}}},'move');
 const log=out.log;
 const a=log.findIndex(x=>x.includes('SW-01 VECTOR'));
 const b=log.findIndex(x=>x.includes('SW-02 VECTOR'));
 const gun=log.findIndex(x=>x.includes('GS-01 VECTOR'));
 assert.ok(a>=0&&b>=0&&gun>=0);
 assert.ok(a<b&&b<gun,'Swarm numerical movement must resolve ahead of Gunstar movement');
});

test('Swarm lasers resolve before Gunstar weapons during online Swarm firing',()=>{
 const battle=c.initialSwarm(false);
 battle.ships.host.q=8;battle.ships.host.r=6;battle.ships.host.d=0;
 for(const [id,ship] of Object.entries(battle.fleet)){
  if(id!=='SW-01')ship.dead=true;
  else{ship.q=9;ship.r=6;ship.d=3}
 }
 const out=c.apply(battle,{host:{plan:'',fire:'laser',arc:0,targets:{laser1:'SW-01',laser2:'none'}},guest:{plan:'',fire:'laser',fleetPlans:{}}},'fire');
 const swarm=out.log.findIndex(line=>line.startsWith('SW-01 LASER'));
 const star=out.log.findIndex(line=>line.startsWith('GS-01 LASER'));
 assert.ok(swarm>=0&&star>=0,'Both ships must attempt a shot');
 assert.ok(swarm<star,'Swarm fire must resolve before Gunstar fire');
});

test('damaging asteroid collision immediately destroys a Swarm Ship',()=>{
 const initial=c.initialSwarm(false).fleet['SW-01'];
 let collided=false;
 for(let turn=1;turn<=40;turn++){
  const ship=JSON.parse(JSON.stringify(initial)),events=[];
  const rock=new Set([ship.q+','+ship.r]);
  if(c.asteroidCollision(ship,rock,turn,'guest',0,3,events)){
   collided=true;
   assert.equal(ship.dead,true);
   assert.equal(ship.hp,0);
   assert.ok(events.some(line=>line.includes('SWARM SHIP DESTROYED BY ASTEROID COLLISION')));
   break;
  }
 }
 assert.ok(collided,'Expected a deterministic collision in 40 checked turns');
});

for(const teamSize of [1,2])test('release gate: '+teamSize+'v'+teamSize+' plays through four legitimate turns to an off-map victory',()=>{
 let state=teamSize===1?c.initial(false):c.initialDoubles(false);
 const slots=Object.keys(state.ships);
 for(let round=1;round<=4;round++){
  const orders=Object.fromEntries(slots.map(slot=>[slot,{
   plan:slot.startsWith('guest')?(round===4?'FF':'FFFFF'):'',
   fire:'none',arc:0,targets:{}
  }]));
  state=c.apply(state,orders,'move');
  if(round===4){
   assert.equal(state.phase,'finished');
   assert.equal(state.winner,'STAR LEAGUE');
   assert.equal(state.turn,4);
  }else{
   assert.equal(state.phase,'targeting');
   state=c.apply(state,orders,'fire');
   assert.equal(state.phase,'orders');
   assert.equal(state.turn,round+1);
   assert.equal(state.winner,null);
  }
 }
 for(const slot of slots.filter(slot=>slot.startsWith('guest')))
  assert.equal(state.ships[slot].dead,true);
 for(const slot of slots.filter(slot=>slot.startsWith('host')))
  assert.equal(state.ships[slot].dead,false);
});

test('live multiplayer resolution errors remain visible and do not spin the resolve button',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../online-battle.js'),'utf8');
 assert.match(source,/resolutionError\?'RESOLUTION FAILED:/);
 assert.match(source,/!resolutionError&&autoAttemptTurn!==phaseKey/);
 assert.match(source,/catch\(e\)\{resolutionError=e\?\.message\|\|String\(e\)/);
 assert.match(source,/\$\('resolve'\)\.onclick=\(\)=>\{resolutionError='';resolveTurn\(\)\}/);
});

test('milestone 2: 1v1 and 2v2 share temporary status lifecycle and speed conflict precedence',()=>{
 const ships=[c.initial(false).ships.host,c.initialDoubles(false).ships.host2];
 for(const [i,ship] of ships.entries()){
  ship.lastMove=4;ship.nextConstant=1;ship.nextHalf=1;ship.nextRestrict=1;ship.nextStabilizer=1;
  const events=[];
  c.endTurnDamageOnline(ship,1,i?'host2':'host',events);
  assert.equal(ship.stabilizer,1);
  assert.equal(ship.restrict,null,'Stabilizer overrides simultaneous steering restriction');
  assert.equal(ship.constant,null,'Speed lock is postponed');
  assert.equal(ship.half,1);
  assert.equal(ship.deferredSpeedTurns,1);
  assert.equal(ship.deferredSpeedTarget,4);
  c.endTurnDamageOnline(ship,2,i?'host2':'host',events);
  assert.equal(ship.half,1);
  assert.equal(ship.deferredSpeedTurns,0);
  assert.equal(ship.constant,null,'Second restricted turn must finish before speed lock');
  c.endTurnDamageOnline(ship,3,i?'host2':'host',events);
  assert.equal(ship.half,0);
  assert.equal(ship.constant,4,'Original pre-conflict speed must be restored');
  assert.ok(events.some(line=>line.includes('SPEED CONFLICT')));
 }
});
test('milestone 2: pilot and gunner injury recovery transitions apply to both federation ships',()=>{
 for(const slot of ['host','host2']){
  const ship=slot==='host'?c.initial(false).ships.host:c.initialDoubles(false).ships.host2;
  ship.pilot=3;ship.unconsciousPilot=2;
  ship.gunner=4;ship.unconsciousGunner=2;
  const events=[];
  c.endTurnDamageOnline(ship,4,slot,events);
  assert.equal(ship.unconsciousPilot,1,'Pilot remains unconscious for next game turn');
  assert.equal(ship.unconsciousGunner,1,'Gunner remains unconscious for next game turn');
  c.endTurnDamageOnline(ship,5,slot,events);
  assert.ok([0,1].includes(ship.unconsciousPilot));
  assert.ok([0,1].includes(ship.unconsciousGunner));
  assert.ok(events.some(line=>line.includes('PILOT')));
  assert.ok(events.some(line=>line.includes('GUNNER')));
 }
});
test('milestone 2: life-support expiry kills pilot without silently destroying the craft',()=>{
 for(const slot of ['host','guest','host2','guest2']){
  const state=slot.endsWith('2')?c.initialDoubles(false):c.initial(false);
  const ship=state.ships[slot];
  ship.life=1;ship.lastMove=2;
  const events=[];c.endTurnDamageOnline(ship,3,slot,events);
  assert.equal(ship.life,0);
  assert.equal(ship.pilot,6);
  assert.equal(ship.killedSpeed,2);
  assert.equal(ship.dead,false);
  assert.ok(events.some(line=>line.includes('LIFE SUPPORT EXPIRED')));
 }
});

test('milestone 2: normal movement damage limits and steering prohibitions are enforced',()=>{
 const ship=c.initial(false).ships.host;
 ship.engine=8;ship.hull=0;
 assert.equal(c.moveLimit(ship),1);
 assert.equal(c.turnLimit(ship),1);
 assert.throws(()=>c.predict(ship,'FF'),/Engine damage limits movement/);
 ship.engine=0;ship.restrict='noL';
 assert.throws(()=>c.predict(ship,'L'),/Steering restriction/);
 ship.restrict='lockF';
 assert.throws(()=>c.predict(ship,'R'),/Steering locked/);
});
test('milestone 2: locked steering and no-speed-change follow the local movement exception',()=>{
 const ship=c.initial(false).ships.host;
 ship.engine=8;
 // The forced single-step vector remains allowed under a steering lock.
 ship.restrict='lockL';
 assert.doesNotThrow(()=>c.predict(ship,'L'));
 assert.throws(()=>c.predict(ship,'F'),/Steering locked/);
 // Normal turning restrictions still apply to an unrestricted ship.
 ship.engine=4;ship.restrict=null;ship.constant=null;
 assert.equal(c.turnLimit(ship),2);
 assert.throws(()=>c.predict(ship,'LLL'),/System damage limits turns/);
 // A constant-speed restriction bypasses the normal turn cap, as in
 // the local FASA rules, without bypassing movement or speed limits.
 ship.constant=3;
 assert.doesNotThrow(()=>c.predict(ship,'LLL'));
 assert.throws(()=>c.predict(ship,'LL'),/Constant-speed damage requires/);
});
test('milestone 2: overlapping temporary damage is deterministic for all four pilots',()=>{
 for(const slot of ['host','guest','host2','guest2']){
  const state=slot.endsWith('2')?c.initialDoubles(false):c.initial(false);
  const ship=state.ships[slot],events=[];
  ship.lastMove=3;ship.nextRestrict=2;ship.nextStabilizer=1;
  c.endTurnDamageOnline(ship,6,slot,events);
  assert.equal(ship.stabilizer,1);
  assert.equal(ship.restrict,null);
  assert.equal(ship.nextRestrict,0);
  assert.equal(ship.nextStabilizer,0);
  assert.ok(events.some(x=>x.includes('STEERING RESTRICTION IGNORED')));
  c.endTurnDamageOnline(ship,7,slot,events);
  assert.equal(ship.stabilizer,0);
 }
});

test('milestone 2: all 36 printed damage-table cells produce their expected subsystem effects',()=>{
 // Force each damage row via the collision table, then choose an actual turn
 // yielding the required white die. Ko-Dan damage targets the pilot for W/K.
 for(let row=0;row<6;row++)for(let col=0;col<6;col++){
  const t=Array.from({length:4000},(_,i)=>i+1).find(t=>c.roll(t*3001+47)===col+1);
  assert.ok(t!==undefined,'A white die outcome must be reachable');
  const ship=c.initial(false).ships.guest,events=[];
  c.damageShip(ship,'laser',t,'guest',events,row+1);
  const code=c.damageRows[row][col];
  assert.ok(events[0].includes('TABLE '+(row+1)+': '+code));
  const expected={F:0,E:0,P:0,T:0,W:0,R:0,S:0,H:0,N:0,L:0,K:0,D:0,X:0};
  for(const part of code.split(',')){
   const key=part[0],amount=Number(part.slice(1))||1;
   expected[key]+=amount;
  }
  assert.equal(ship.hull||0,expected.F,'Fuselage mismatch in '+code);
  assert.equal(ship.engine||0,expected.E,'Engine mismatch in '+code);
  assert.equal(ship.power,20-expected.P,'Power mismatch in '+code);
  assert.equal(ship.aim||0,expected.T,'Targeting mismatch in '+code);
  assert.equal(ship.pilot||0,expected.K?6:expected.W,'Pilot injury mismatch in '+code);
  assert.equal(ship.nextRestrict||0,expected.R,'Steering damage mismatch in '+code);
  assert.equal(ship.nextStabilizer||0,expected.S,'Stabilizer damage mismatch in '+code);
  assert.equal(ship.nextHalf||0,expected.H,'Half-speed damage mismatch in '+code);
  assert.equal(ship.nextConstant||0,expected.N,'Constant-speed damage mismatch in '+code);
  assert.equal(ship.life||0,expected.L?6:0,'Life-support mismatch in '+code);
  assert.equal(!!ship.dead,!!expected.D,'Destruction mismatch in '+code);
  assert.equal(ship.hp,ship.dead?0:20-expected.F,'Remaining hull mismatch in '+code);
  if(expected.X){
   assert.ok(ship.laserLoss||ship.particleLost||ship.missileLost,'X must disable a weapon: '+code);
  }
 }
});

test('milestone 2: destroyed weapon groups are excluded before power-channel limits',()=>{
 const gun=c.initial(false).ships.host;gun.engine=8;gun.laserLoss=2;
 assert.deepEqual(Array.from(c.usableWeaponKinds(gun,'host',['laser','particle','missile'])),['particle','missile']);
 gun.particleLost=true;
 assert.deepEqual(Array.from(c.usableWeaponKinds(gun,'host',['laser','particle','missile'])),['missile']);
 gun.missileLost=true;
 assert.equal(c.usableWeaponKinds(gun,'host',['laser','particle','missile']).length,0);
});
test('milestone 2: gunner can fire after pilot death, but not after gunner incapacitation',()=>{
 const gun=c.initial(false).ships.host;gun.pilot=6;
 assert.equal(c.fireControlCrewReason(gun,'host'),null);
 gun.gunner=6;
 assert.match(c.fireControlCrewReason(gun,'host'),/GUNNER KILLED/);
 gun.gunner=0;gun.unconsciousGunner=1;
 assert.match(c.fireControlCrewReason(gun,'host'),/GUNNER UNCONSCIOUS/);
 const deck=c.initial(false).ships.guest;deck.pilot=6;
 assert.match(c.fireControlCrewReason(deck,'guest'),/PILOT KILLED/);
});
test('milestone 2: 2v2 gunstar pilot casualty does not prevent gunner firing while teammate remains alive',()=>{
 let state=c.initialDoubles(false);
 state.ships.host.pilot=6;state.ships.host.gunner=0;
 state.ships.host.q=4;state.ships.host.r=4;state.ships.host.d=0;
 state.ships.guest.q=7;state.ships.guest.r=4;
 for(const side of Object.keys(state.ships))state.ships[side].power=20;
 const order=Object.fromEntries(Object.keys(state.ships).map(slot=>[slot,{
  plan:'',fire:slot==='host'?'laser':'none',arc:0,targets:{laser1:'guest',laser2:'guest'}
 }]));
 const afterMove=c.apply(state,order,'move');
 assert.equal(afterMove.phase,'targeting','Remaining teammate keeps battle alive');
 const outcome=c.apply(afterMove,order,'fire');
 assert.ok(outcome.log.some(x=>x.includes('HOST LASER')&&x.includes('GUEST')),
  'Gunner should resolve a laser attack despite dead pilot');
});

test('milestone 2: 2v2 shot threshold matches preview with shooter inside an asteroid hex',()=>{
 const state=c.initialDoubles(false);
 state.ships.host.q=4;state.ships.host.r=4;state.ships.host.d=0;
 state.ships.guest.q=5;state.ships.guest.r=4;state.ships.guest.lastMove=1;
 state.asteroids=['4,4'];
 const orders=Object.fromEntries(Object.keys(state.ships).map(slot=>[slot,{
  plan:'',fire:slot==='host'?'laser':'none',arc:0,targets:{laser1:'guest',laser2:'guest'}
 }]));
 const legal=c.weaponTargets(state,'host','laser',0,0,orders.host);
 const preview=legal.find(x=>x.id==='guest');
 assert.ok(preview,'Adjacent target must be legal');
 const clear=c.initialDoubles(false);
 clear.ships.host.q=4;clear.ships.host.r=4;clear.ships.host.d=0;
 clear.ships.guest.q=5;clear.ships.guest.r=4;clear.ships.guest.lastMove=1;
 const clearPreview=c.weaponTargets(clear,'host','laser',0,0,orders.host).find(x=>x.id==='guest');
 assert.equal(preview.toHit,clearPreview.toHit+1,'Asteroid should impose +1 target number');
 const fired=c.apply(state,orders,'fire');
 assert.ok(fired.log.some(x=>x.includes('HOST LASER')&&x.includes('VS '+preview.toHit)),
  'Resolved laser target number must equal the on-screen preview');
});

test('FASA p17: forced steering permits four turns, unrestricted movement does not',()=>{
 const ship=c.initial(false).ships.host;
 assert.throws(()=>c.predict(ship,'LLLL'),/System damage limits turns/);
 ship.restrict='lockL';
 assert.doesNotThrow(()=>c.predict(ship,'LLLL'));
 ship.restrict=null;ship.constant=4;
 assert.doesNotThrow(()=>c.predict(ship,'LLLL'));
});
test('FASA p19: photon target list includes clearable asteroid but laser target list excludes it',()=>{
 const s=c.initial(false);s.asteroids=['4,6'];s.ships.host.d=0;
 const targets=c.weaponTargets(s,'host','missile',0,0,{arc:0});
 assert.ok(targets.some(t=>t.id==='asteroid:4,6'));
 assert.ok(!c.weaponTargets(s,'host','laser',0,0,{arc:0}).some(t=>t.id==='asteroid:4,6'));
 const t=targets.find(t=>t.id==='asteroid:4,6');
 assert.equal(t.toHit,7,'Base 5 + one extra hex + asteroid +1');
 assert.deepEqual({...c.parseAsteroidTarget(t.id,c.rocksFor(s))},{q:4,r:6});
});
test('FASA p19: an empty asteroid hex can be cleared by a declared photon missile in 1v1 and 2v2',()=>{
 for(const mode of ['duel','doubles']){
  const orderSlots=mode==='duel'?['host','guest']:['host','guest','host2','guest2'];
  const base=mode==='duel'?c.initial(false):c.initialDoubles(false);
  base.asteroids=['4,6'];base.ships.host.q=2;base.ships.host.r=6;base.ships.host.d=0;
  const orders=Object.fromEntries(orderSlots.map(slot=>[slot,{plan:'',fire:slot==='host'?'missile':'none',targets:slot==='host'?{missile1:'asteroid:4,6'}:{},arc:0}]));
  const initialMissiles=base.ships.host.missiles;
  let cleared=false;
  for(let turn=1;turn<140;turn++){
   const s=structuredClone(base);s.turn=turn;
   const result=c.apply(s,orders,'fire');
   assert.equal(result.ships.host.missiles,initialMissiles-1,'Missile consumed even on miss');
   if(!result.asteroids.includes('4,6')){
    cleared=true;
    assert.ok(result.log.some(x=>/ASTEROID DESTROYED/.test(x)));
    assert.ok(result.lastVolley.shots.some(x=>x.kind==='missile'&&x.hit));
    break;
   }
  }
  assert.ok(cleared,mode+' can successfully target and clear empty asteroid hex');
 }
});
test('FASA p19: asteroid missile burst damages only starships occupying the target rock hex',()=>{
 const s=c.initialDoubles(false);s.asteroids=['4,6'];
 s.ships.guest.q=4;s.ships.guest.r=6;
 s.ships.guest2.q=5;s.ships.guest2.r=6;
 const hits={host:[],guest:[],host2:[],guest2:[]},events=[];
 c.missileBlast(s,c.rocksFor(s),{q:4,r:6},hits,events,'host');
 assert.equal(hits.guest.length,1);
 assert.equal(hits.guest2.length,0);
 assert.ok(!s.asteroids.includes('4,6'));
});
