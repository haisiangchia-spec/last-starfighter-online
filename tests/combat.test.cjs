// Run: node --test tests/combat.test.cjs
// Loads the actual production combat engine, excluding Firebase/browser wiring.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../online-battle.js'),'utf8');
const start=source.indexOf('const dirs=');
const end=source.indexOf('function applySwarm(');
assert.ok(start>=0&&end>start,'Combat engine source boundaries changed');
const engine=source.slice(start,end);
const sandbox={structuredClone,console};
vm.createContext(sandbox);
vm.runInContext(engine+'\nthis.combat={initial,initialDoubles,apply,applyDoubles,asteroidCollision,missileBlast,rocksFor,damageShip,roll,damageRows,crewThreshold,crewInjuryCheck,recoverCrewOnline,hexLine,firingBlocked,facingToTarget};',sandbox,{filename:'online-battle.js'});
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
 assert.ok(render.includes('ALL PILOTS READY — resolving turn automatically.'));
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

test('2v2 never declares victory merely because both opposing pilots are killed',()=>{
 const battle=c.initialDoubles(false),orders={};
 for(const slot of Object.keys(battle.ships))orders[slot]={plan:'',fire:'none',target:''};
 battle.ships.guest.pilot=6;battle.ships.guest2.pilot=6;
 const next=c.apply(battle,orders);
 assert.equal(next.winner,null);
 assert.equal(next.phase,'orders');
 assert.equal(next.ships.guest.dead,false);
 assert.equal(next.ships.guest2.dead,false);
});
test('2v2 defeat requires both enemy ships physically destroyed, even when one pilot is dead',()=>{
 const battle=c.initialDoubles(false),orders={};
 for(const slot of Object.keys(battle.ships))orders[slot]={plan:'',fire:'none',target:''};
 battle.ships.guest.dead=true;battle.ships.guest2.pilot=6;
 assert.equal(c.apply(battle,orders).winner,null);
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
 assert.match(source,/const defeated=side=>battleSlots\.filter\(x=>teamSide\(x\)===side\)\.every\(x=>out\.ships\[x\]\.dead\)/);
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
 const ship={...c.initial(false).ships.host,q:6,r:3};
 const rocks=c.rocksFor(c.initial(true)),events=[];
 c.asteroidCollision(ship,rocks,1,'host',0,4,events);
 assert.equal(ship.asteroidChecks,1);
 assert.match(events[0],/ASTEROID HEX 6,3: 2D6 .* VS 6/);
});
test('asteroid-free hex never triggers collision check',()=>{
 const ship={...c.initial(false).ships.host,q:5,r:3},events=[];
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
 s.ships.guest.q=6;s.ships.guest.r=3;
 s.ships.guest2.q=6;s.ships.guest2.r=4;
 s.ships.host.q=6;s.ships.host.r=3;
 const hits={host:[],guest:[],host2:[],guest2:[]},events=[],rocks=c.rocksFor(s);
 c.missileBlast(s,rocks,s.ships.guest,hits,events,'host2');
 assert.equal(hits.host.length,1);
 assert.equal(hits.guest.length,1);
 assert.equal(hits.guest2.length,0);
 assert.equal(rocks.has('6,3'),false);
 assert.ok(!s.asteroids.some(p=>p==='6,3'));
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
 assert.match(rules,/allow create: if member\(\) && orderId == \(battle\(\)\.matchId \+ '_' \+ string\(battle\(\)\.turn\) \+ '_' \+ side\(\)\)/);
 assert.match(source,/\x60\$\{matchId\|\|'legacy'\}_\$\{turn\}_\$\{side\}\x60/);
});
test('both players render the same server-provided asteroid coordinates',()=>{
 assert.match(source,/state\.asteroids\.map\(p=>rockCoords\(p\)\.join\(','\)\)\.sort\(\)/);
 assert.match(source,/for\(const asteroid of \(state\.asteroids\|\|\[\]\)\)/);
});
