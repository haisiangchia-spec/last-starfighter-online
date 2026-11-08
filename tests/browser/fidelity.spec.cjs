const {test,expect}=require('@playwright/test');
const url='/index.html?emulator=1';
let pilotSequence=0;
test.afterEach(async({},testInfo)=>{
 if(testInfo.status===testInfo.expectedStatus)return;
 console.error('BROWSER FAILURE:',testInfo.title,'status=',testInfo.status);
 for(const error of testInfo.errors||[])console.error('BROWSER ERROR:',error.message);
});
async function openPilot(browser){
 const context=await browser.newContext();const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await expect(page.locator('#authStatus')).toContainText('CONNECTED',{timeout:30000});
 await page.locator('#pilotName').fill('TEST PILOT '+(++pilotSequence));
 return {context,page,errors};
}

test('lobby requires a name, randomizes initial faction and seed, and defaults asteroids on',async({browser})=>{
 const pilot=await openPilot(browser);
 try{
  const page=pilot.page;
  await page.locator('#pilotName').fill('');
  await page.locator('#create').click();
  await expect(page.locator('#notice')).toContainText('Enter your pilot name');
  await expect(page.locator('#roomPanel')).toBeHidden();
  await page.locator('#pilotName').fill('Commander Vega');
  await page.locator('#create').click();
  await expect(page.locator('#roomPanel')).toBeVisible();
  await expect(page.locator('#side')).toContainText('Commander Vega');
  await expect(page.locator('#lobbyAsteroids')).toBeChecked();
  await expect(page.locator('#asteroidPreview')).toHaveCount(0);
  await expect(page.locator('#joinFaction')).toHaveCount(0);
  const seed=Number(await page.locator('#seedStatus').textContent());
  expect(Number.isInteger(seed)&&seed>=1&&seed<=4294967295).toBe(true);
  // An independently generated room gets a new random seed, not a fixed default.
  const previousRoom=(await page.locator('#roomCode').textContent()).trim();
  await page.locator('#create').click();
  await expect(page.locator('#roomCode')).not.toHaveText(previousRoom,{timeout:30000});
  const second=Number(await page.locator('#seedStatus').textContent());
  expect(second).not.toBe(seed);
  await expect(page.locator('#lobbyAsteroids')).toBeChecked();
  expect(pilot.errors).toEqual([]);
 }finally{await pilot.context.close()}
});
test('local AI duel, clear-space Swarm, asteroid Swarm and hot-seat render without exceptions',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [scenario,mode,asteroids,count,facing] of [
  ['duel','ai','none',2,3],['swarm','ai','none',15,0],['swarm','ai','field',15,3],['duel','hotseat','none',2,3]
 ]){
  await page.goto('/game.html?scenario='+scenario+'&mode='+mode);
  await page.locator('#asteroids').selectOption(asteroids);
  await page.locator('#new').click();
  const data=await page.evaluate(()=>({...window.__starfighterTestState(),canvas:document.querySelector('canvas').getBoundingClientRect().width}));
  expect(data.ships).toHaveLength(count);expect(data.ships[0].id).toBe('GS-01');
  expect(data.ships[1].d).toBe(facing);expect(data.canvas).toBeGreaterThan(100);
  if(asteroids==='field'){
   // House rule: 2x seven-hex clusters + 10–20 distinct single hexes.
   expect(data.rocks.length).toBeGreaterThanOrEqual(24);
   expect(data.rocks.length).toBeLessThanOrEqual(34);
   expect(new Set(data.rocks).size).toBe(data.rocks.length);
   for(const id of data.rocks){
    const [q,r]=id.split(',').map(Number);
    for(const ship of data.ships)
     expect(Math.max(Math.abs(q-ship.q),Math.abs(r-ship.r),Math.abs(q+r-ship.q-ship.r))).toBeGreaterThan(1);
   }
  }
  if(scenario==='swarm'){
   expect(data.ships.slice(1,8).map(s=>s.r)).toEqual([3,4,5,6,7,8,9]);
   expect(data.ships.slice(8).map(s=>s.r)).toEqual([3,4,5,6,7,8,9]);
  }
 }
 expect(errors).toEqual([]);
});
test('local hot-seat requires separate sealed orders and advances after both players commit',async({page})=>{
 await page.goto('/game.html?scenario=duel&mode=hotseat');
 await expect(page.locator('#status')).toContainText('STAR LEAGUE');
 await page.locator('#execute').click();
 await expect(page.locator('#status')).toContainText('KO-DAN');
 await expect(page.locator('#turn')).toHaveText('01');
 await page.locator('#execute').click();
 await expect(page.locator('#phase')).toHaveText('TARGETING',{timeout:30000});
 await expect(page.locator('#localTargetPanel')).toBeVisible();
 await expect(page.locator('#status')).toContainText('STAR LEAGUE');
 await page.locator('#execute').click();
 await expect(page.locator('#status')).toContainText('KO-DAN');
 await page.locator('#execute').click();
 await expect(page.locator('#turn')).toHaveText('02',{timeout:30000});
});
test('local hot-seat keeps orders sealed and advances through three complete turns',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/game.html?scenario=duel&mode=hotseat');
 for(let round=1;round<=3;round++){
  await expect(page.locator('#turn')).toHaveText(String(round).padStart(2,'0'));
  await expect(page.locator('#status')).toContainText('STAR LEAGUE');
  await page.locator('#execute').click();
  await expect(page.locator('#status')).toContainText('KO-DAN');
  await expect(page.locator('#turn')).toHaveText(String(round).padStart(2,'0'));
  await page.locator('#execute').click();
  await expect(page.locator('#phase')).toHaveText('TARGETING',{timeout:30000});
  await expect(page.locator('#localTargetPanel')).toBeVisible();
  await expect(page.locator('#status')).toContainText('STAR LEAGUE');
  await page.locator('#execute').click();
  await expect(page.locator('#status')).toContainText('KO-DAN');
  await page.locator('#execute').click();
  await expect(page.locator('#turn')).toHaveText(String(round+1).padStart(2,'0'),{timeout:30000});
 }
 expect(errors).toEqual([]);
});
test('local versus-computer duel resolves movement, targeting and firing',async({page})=>{
 await page.goto('/game.html?scenario=duel&mode=ai');
 await page.locator('#execute').click();
 await expect(page.locator('#phase')).toHaveText('TARGETING',{timeout:30000});
 await expect(page.locator('#localTargetPanel')).toBeVisible();
 await page.locator('#execute').click();
 await expect(page.locator('#turn')).toHaveText('02',{timeout:30000});
});
for(const size of [1,2])test('real Firebase emulator human '+size+'v'+size+' sealed orders and turn resolution',async({browser})=>{
 const pilots=[];
 try{
  for(let i=0;i<size*2;i++)pilots.push(await openPilot(browser));
  const host=pilots[0].page;await host.locator('#create').click();
  await expect(host.locator('#roomPanel')).toBeVisible();
  const code=(await host.locator('#roomCode').textContent()).trim();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  for(let i=1;i<pilots.length;i++){
   const p=pilots[i].page;
   await p.locator('#codeInput').fill(code);await p.locator('#join').click();
   await expect(p.locator('#roomPanel')).toBeVisible();
  }
  await expect(host.locator('#lobbyAsteroids')).toBeChecked();
  await expect(host.locator('#asteroidPreview')).toHaveCount(0);
  await host.locator('#battleSeed').fill('43112');
  await host.locator('#battleSeed').dispatchEvent('change');
  await expect(host.locator('#seedStatus')).toHaveText('43112');
  for(const {page} of pilots){await page.locator('#ready').click()}
  await expect(host.locator('#launch')).toBeEnabled({timeout:20000});
  for(const {page} of pilots){
   const name=await page.locator('#pilotName').inputValue();
   await page.goto('/online-battle.html?emulator=1#room='+code);
   await expect(page.locator('#turn')).toHaveText('1',{timeout:30000});
   await expect(page.locator('#asteroidSync')).toContainText('ASTEROID FIELD ACTIVE');
   await expect(page.locator('#identity')).toContainText(name);
  }
  const asteroidLabels=await Promise.all(pilots.map(async({page})=>(await page.locator('#asteroidSync').textContent()).trim()));
  expect(new Set(asteroidLabels).size).toBe(1);
  expect(asteroidLabels[0]).toMatch(/^ASTEROID FIELD ACTIVE · [0-9]+ ROCKS$/);
  const rockCount=Number(asteroidLabels[0].match(/(\d+) ROCKS$/)[1]);
  expect(rockCount).toBeGreaterThanOrEqual(24);
  expect(rockCount).toBeLessThanOrEqual(34);
  if(size===2){for(const {page} of pilots){await expect(page.locator('#fleetStatus')).toBeVisible();for(const ship of ['GS-01','GS-02','DF-01','DF-02'])await expect(page.locator('#fleetStatus')).toContainText(ship)}}
  // Each round now has two synchronized commits: sealed movement, then targets.
  async function playRound(round){
   for(const {page} of pilots){
    await expect(page.locator('#submit')).toHaveText('COMMIT MOVEMENT',{timeout:30000});
    await expect(page.locator('#movementControls')).toBeVisible();
    await expect(page.locator('#arcSettings')).toBeVisible();
    await expect(page.locator('#allowedMoves')).toHaveText(round===1?'5 / 5':/^\d+ \/ 5$/);
    await expect(page.locator('#allowedTurns')).toHaveText(round===1?'3 / 3':/^(\d+ \/ 3|RANDOM)$/);
    await expect(page.locator('#movementRemaining')).toContainText('0 / ');
    await expect(page.locator('#quickTurn')).toContainText('MOVEMENT');
    await expect(page.locator('#quickResources')).toContainText('POWER ');
    await expect(page.locator('#quickResources')).toContainText('HULL ');
    await expect(page.locator('#quickResources')).toContainText('MISSILES ');
    await expect(page.locator('#laser')).toBeEnabled();
    await page.locator('#submit').click();
    await expect(page.locator('#status')).not.toContainText('ORDER REJECTED',{timeout:15000});
   }
   if(round===2){
    // Reconnect after movement but before target declaration. The synchronized
    // board must remain in targeting, with legal default targets regenerated.
    const reconnecting=pilots[pilots.length-1].page;
    await reconnecting.reload();
    await expect(reconnecting.locator('#targetingPanel')).toBeVisible({timeout:30000});
    await expect(reconnecting.locator('#turn')).toHaveText(String(round));
    await expect(reconnecting.locator('#submit')).toHaveText('LOCK WEAPON TARGETS');
   }
   for(const {page} of pilots){
    await expect(page.locator('#targetingPanel')).toBeVisible({timeout:30000});
    await expect(page.locator('#turn')).toHaveText(String(round));
    await expect(page.locator('#submit')).toHaveText('LOCK WEAPON TARGETS');
    await expect(page.locator('#movementControls')).toBeHidden();
    await expect(page.locator('#arcSettings')).toBeHidden();
    await expect(page.locator('#targetingPanel')).toBeVisible();
    await expect(page.locator('#quickTurn')).toContainText('TARGETING');
    const assignments=page.locator('select.target-assignment');
    if(await assignments.count()){
     const options=await assignments.first().locator('option').evaluateAll(nodes=>nodes.map(n=>n.value));
     const selected=await assignments.first().inputValue();
     // A valid firing solution is preselected rather than HOLD FIRE.
     expect(selected).toBe(options.length>1?options[1]:'none');
     // Even a preselected target may be overridden to hold fire.
     if(round===1){
      await assignments.first().selectOption('none');
      await expect(assignments.first()).toHaveValue('none');
     }
     // The 1v1 reconnect regression must exercise a surviving battle at
     // Turn 2, independently of lucky first-turn damage rolls.
     if(size===1)for(let j=0;j<await assignments.count();j++)await assignments.nth(j).selectOption('none');
    }
    // Targets must be independently selectable for each weapon.
    if(size===2){
     const assignments=page.locator('select.target-assignment');
     expect(await assignments.count()).toBeGreaterThanOrEqual(1);
    }
   }
   for(let i=0;i<pilots.length;i++){
    const page=pilots[i].page;
    await page.locator('#submit').click();
    await expect(page.locator('#status')).not.toContainText('ORDER REJECTED',{timeout:15000});
    if(round===3&&i===0){
     // Reload a pilot who has already committed. Duplicate target submissions
     // must remain disabled until the remaining pilots finish this phase.
     await expect(page.locator('#submit')).toBeDisabled({timeout:30000});
     await page.reload();
     await expect(page.locator('#targetingPanel')).toBeVisible({timeout:30000});
     await expect(page.locator('#submit')).toBeDisabled();
    }
   }
   for(const {page} of pilots){
    await expect(page.locator('#turn')).toHaveText(String(round+1),{timeout:30000});
    await expect(page.locator('#targetingPanel')).toBeHidden();
   }
  }
  await playRound(1);
  const reconnect=pilots[pilots.length-1].page;
  await reconnect.reload();
  await expect(reconnect.locator('#turn')).toHaveText('2',{timeout:30000});
  await expect(reconnect.locator('#asteroidSync')).toContainText('ASTEROID FIELD ACTIVE');
  for(const round of [2,3])await playRound(round);
  for(const {errors} of pilots)expect(errors).toEqual([]);
 }finally{await Promise.all(pilots.map(p=>p.context.close()))}
});

test('Death Blossom presents six independently selectable rotation volleys and forces recharge',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/game.html?scenario=swarm&mode=ai&battle_test=1');
 await page.evaluate(()=>{
  const game=window.__battleTest;
  game.setup('swarm',{mode:'ai',asteroids:'none'});
  game.damage('GS-01',{power:8});
  // Isolate the special-fire sequence: no incoming Swarm damage can prevent activation.
  for(let i=1;i<=14;i++)game.damage('SW-'+String(i).padStart(2,'0'),{laserLoss:1});
 });
 await page.locator('#execute').click();
 await expect(page.locator('#phase')).toHaveText('TARGETING',{timeout:30000});
 await page.locator('#execute').click();
 await expect(page.locator('#phase')).toHaveText('BLOSSOM-DECISION',{timeout:30000});
 await expect(page.locator('#blossom')).toBeEnabled();
 await expect(page.locator('#execute')).toHaveText('FIRE NORMALLY');
 await page.locator('#blossom').click();
 for(let rotation=1;rotation<=6;rotation++){
  await expect(page.locator('#phase')).toHaveText('BLOSSOM-TARGETING',{timeout:30000});
  await expect(page.locator('#localTargetPanel')).toBeVisible();
  await expect(page.locator('#execute')).toHaveText('FIRE THIS ROTATION');
  const options=page.locator('select.localTargetSelect');
  if(await options.count()){
   await options.first().selectOption('none');
  }
  await page.locator('#execute').click();
 }
 await expect(page.locator('#turn')).toHaveText('02',{timeout:30000});
 const after=await page.evaluate(()=>window.__battleTest.state());
 const gunstar=after.ships.find(s=>s.id==='GS-01');
 expect(gunstar.power).toBe(0);
 expect(gunstar.missiles).toBe(4); // Optional missiles default to HOLD.
 const blossoming=after.history.filter(line=>line.includes('DEATH BLOSSOM ROTATION'));
 expect(blossoming).toHaveLength(6);
 await expect(page.locator('#status')).toContainText('MANDATORY DEATH BLOSSOM RECHARGE');
 await expect(page.locator('#laser')).toBeDisabled();
 await expect(page.locator('#particle')).toBeDisabled();
 await expect(page.locator('#missile')).toBeDisabled();
 const position={q:gunstar.q,r:gunstar.r};
 await page.locator('#execute').click();
 await expect(page.locator('#phase')).toHaveText('TARGETING',{timeout:30000});
 await page.locator('#execute').click();
 await expect(page.locator('#turn')).toHaveText('03',{timeout:30000});
 const recovered=await page.evaluate(()=>window.__battleTest.state());
 const afterRecharge=recovered.ships.find(s=>s.id==='GS-01');
 expect([afterRecharge.q,afterRecharge.r]).toEqual([position.q,position.r]);
 expect(afterRecharge.power).toBe(5);
 expect(recovered.history.some(line=>line.includes('GS-01 RECHARGED +5 POWER'))).toBe(true);
 expect(errors).toEqual([]);
});

test('Gunstar may decline Death Blossom after Swarm fire and finish normal firing',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/game.html?scenario=swarm&mode=ai&battle_test=1');
 await page.evaluate(()=>{
  const game=window.__battleTest;
  game.setup('swarm',{mode:'ai',asteroids:'none'});
  game.damage('GS-01',{power:8});
  for(let i=1;i<=14;i++)game.damage('SW-'+String(i).padStart(2,'0'),{laserLoss:1});
 });
 await page.locator('#execute').click();
 await expect(page.locator('#phase')).toHaveText('TARGETING',{timeout:30000});
 await page.locator('#execute').click();
 await expect(page.locator('#phase')).toHaveText('BLOSSOM-DECISION',{timeout:30000});
 await page.locator('#execute').click();
 await expect(page.locator('#turn')).toHaveText('02',{timeout:30000});
 const final=await page.evaluate(()=>window.__battleTest.state());
 expect(final.history.some(line=>line.includes('GUNSTAR ELECTS NORMAL FIRE'))).toBe(true);
 expect(final.history.filter(line=>line.includes('DEATH BLOSSOM ROTATION'))).toHaveLength(0);
 expect(errors).toEqual([]);
});

for(const size of [1,2])test('release gate: real '+size+'v'+size+' completes from lobby to winner and survives result reload',async({browser})=>{
 test.setTimeout(240000);
 const pilots=[];
 try{
  for(let i=0;i<size*2;i++)pilots.push(await openPilot(browser));
  const host=pilots[0].page;
  await host.locator('#create').click();
  await expect(host.locator('#roomPanel')).toBeVisible();
  const room=(await host.locator('#roomCode').textContent()).trim();
  expect(room).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  for(let i=1;i<pilots.length;i++){
   const page=pilots[i].page;
   await page.locator('#codeInput').fill(room);
   await page.locator('#join').click();
   await expect(page.locator('#roomPanel')).toBeVisible();
  }
  // The room creator owns configuration even if assigned to Ko-Dan.
  const factions=await Promise.all(pilots.map(async({page})=>(await page.locator('#side').textContent()).includes('STAR LEAGUE')?'host':'guest'));
  expect(factions.filter(x=>x==='host')).toHaveLength(size);
  expect(factions.filter(x=>x==='guest')).toHaveLength(size);
  // Use a clear starfield so off-map victory is deterministic and requires no test-only state mutation.
  await host.locator('#lobbyAsteroids').uncheck();
  for(const {page} of pilots)await page.locator('#ready').click();
  await expect(host.locator('#launch')).toBeEnabled({timeout:20000});
  for(const {page} of pilots){
   await page.goto('/online-battle.html?emulator=1#room='+room);
   await expect(page.locator('#turn')).toHaveText('1',{timeout:30000});
   await expect(page.locator('#asteroidSync')).toContainText('CLEAR SPACE');
  }
  for(let round=1;round<=4;round++){
   for(let i=0;i<pilots.length;i++){
    const page=pilots[i].page;
    await expect(page.locator('#submit')).toHaveText('COMMIT MOVEMENT',{timeout:30000});
    await expect(page.locator('#turn')).toHaveText(String(round));
    await expect(page.locator('#movementControls')).toBeVisible();
    for(const kind of ['laser','particle','missile'])await page.locator('#'+kind).uncheck();
    // Deck Fighters move west toward and eventually off the left edge; Gunstar ships hold.
    await page.locator('#plan').fill(factions[i]==='host'?'':round===4?'FF':'FFFFF');
    await page.locator('#submit').click();
    await expect(page.locator('#status')).not.toContainText('ORDER REJECTED');
   }
   if(round<4){
    for(const {page} of pilots){
     await expect(page.locator('#targetingPanel')).toBeVisible({timeout:30000});
     await expect(page.locator('#movementControls')).toBeHidden();
     await expect(page.locator('#submit')).toHaveText('LOCK WEAPON TARGETS');
    }
    for(const {page} of pilots)await page.locator('#submit').click();
    for(const {page} of pilots)await expect(page.locator('#turn')).toHaveText(String(round+1),{timeout:30000});
   }else{
    for(let i=0;i<pilots.length;i++){
     const page=pilots[i].page;
     await expect(page.locator('#battleResult')).toBeVisible({timeout:30000});
     await expect(page.locator('#resultTitle')).toContainText(factions[i]==='host'?'VICTORY · STAR LEAGUE':'DEFEAT · STAR LEAGUE');
     await expect(page.locator('#targetingPanel')).toBeHidden();
     await expect(page.locator('#submit')).toBeDisabled();
    }
   }
  }
  // Result state must survive reload on both sides, without reopening movement orders.
  for(let i of [0,pilots.length-1]){
   const page=pilots[i].page;
   await page.reload();
   await expect(page.locator('#battleResult')).toBeVisible({timeout:30000});
   await expect(page.locator('#resultTitle')).toContainText(factions[i]==='host'?'VICTORY · STAR LEAGUE':'DEFEAT · STAR LEAGUE');
  }
  for(const pilot of pilots)expect(pilot.errors).toEqual([]);
 }finally{await Promise.all(pilots.map(p=>p.context.close()))}
});

test('lobby routes local AI through multiplayer tactical interface and excludes pass-and-play',async({page})=>{
 await page.goto('/index.html');
 const localLinks=page.locator('a[href^="./local-battle.html"]');
 await expect(localLinks).toHaveCount(2);
 await expect(page.locator('a[href*="mode=hotseat"]')).toHaveCount(0);
 await expect(page.locator('a[href*="game.html?scenario"]')).toHaveCount(0);
});
for(const localScenario of ['duel','swarm'])test('shared multiplayer battle UI works for local '+localScenario+' AI',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/local-battle.html?scenario='+localScenario+'&seed=1984');
 await expect(page.locator('#identity')).toContainText('LOCAL AI');
 await expect(page.locator('#localScenario')).toHaveValue(localScenario);
 await expect(page.locator('#battleQuickStatus')).toBeVisible();
 await expect(page.locator('#map')).toBeVisible();
 await expect(page.locator('#movementControls')).toBeVisible();
 await expect(page.locator('#targetingPanel')).toBeHidden();
 await expect(page.locator('#submit')).toHaveText('COMMIT MOVEMENT');
 const initial=await page.evaluate(()=>window.__localBattleTest.state());
 expect(initial.turn).toBe(1);
 expect(localScenario==='swarm'?Object.keys(initial.fleet).length:Object.keys(initial.ships).length).toBe(localScenario==='swarm'?14:2);
 await page.locator('#submit').click();
 await expect(page.locator('#targetingPanel')).toBeVisible();
 await expect(page.locator('#submit')).toHaveText('LOCK WEAPON TARGETS');
 await page.locator('#submit').click();
 await expect(page.locator('#turn')).toHaveText('2');
 await expect(page.locator('#movementControls')).toBeVisible();
 await expect(page.locator('#targetingPanel')).toBeHidden();
 expect(errors).toEqual([]);
});
test('local shared tactical screen can restart with randomized clustered asteroids',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/local-battle.html?scenario=swarm&asteroids=off');
 await page.locator('#localAsteroids').selectOption('on');
 await page.locator('#localSeed').fill('2026');
 await page.locator('#newLocalMission').click();
 await expect(page.locator('#asteroidSync')).toContainText('ASTEROID FIELD ACTIVE');
 const battle=await page.evaluate(()=>window.__localBattleTest.state());
 expect(battle.asteroids.length).toBeGreaterThanOrEqual(24);
 expect(battle.asteroids.length).toBeLessThanOrEqual(34);
 expect(new Set(battle.asteroids).size).toBe(battle.asteroids.length);
 expect(errors).toEqual([]);
});

test('local Swarm shares multiplayer targeting controls for six Death Blossom rotations',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/local-battle.html?scenario=swarm&asteroids=off&battle_test=1');
 await page.evaluate(()=>window.__localBattleTest.setGunstarPower(8));
 await page.locator('#submit').click();
 await expect(page.locator('#targetingPanel')).toBeVisible();
 await expect(page.locator('#blossom')).toBeEnabled();
 await page.locator('#blossom').click();
 await expect(page.locator('#blossom')).toHaveText('CANCEL DEATH BLOSSOM');
 await expect(page.locator('#submit')).toHaveText('FIRE DEATH BLOSSOM');
 await expect(page.locator('.blossom-arc')).toHaveCount(6);
 await expect(page.locator('#weaponTargetRows')).toContainText('ROTATION 6/6');
 await page.locator('.blossom-arc').first().selectOption('5');
 await expect(page.locator('.blossom-arc').first()).toHaveValue('5');
 await page.locator('#blossom').click();
 await expect(page.locator('#blossom')).toHaveText('DEATH BLOSSOM');
 await expect(page.locator('#submit')).toHaveText('LOCK WEAPON TARGETS');
 expect(errors).toEqual([]);
});
test('shared local AI map supports click-to-inspect and firing arc toggling',async({page})=>{
 await page.goto('/local-battle.html?scenario=duel&asteroids=off&seed=1984');
 const canvas=page.locator('#map');
 await expect(canvas).toBeVisible();
 const initial=await page.locator('#toggleArcs').textContent();
 await page.locator('#toggleArcs').click();
 expect(await page.locator('#toggleArcs').textContent()).not.toBe(initial);
 const {x,y}=await page.evaluate(()=>{
  const c=document.getElementById('map'),b=c.getBoundingClientRect();
  const R=Math.min((c.width-50)/(Math.sqrt(3)*(19+13/2)),(c.height-50)/(1.5*13+.5));
  const cx=c.width/2-Math.sqrt(3)*(19/2+13/4)*R,cy=c.height/2-1.5*(13-1)/2*R;
  const p=window.__localBattleTest.state().ships.host;
  const scale=Math.min(b.width/c.width,b.height/c.height);
  const dx=(b.width-c.width*scale)/2,dy=(b.height-c.height*scale)/2;
  return {x:b.left+dx+(cx+Math.sqrt(3)*(p.q+p.r/2)*R)*scale,y:b.top+dy+(cy+1.5*p.r*R)*scale};
 });
 await page.mouse.click(x,y);
 await expect(page.locator('#inspectDialog')).toBeVisible();
 await expect(page.locator('#inspectTitle')).toContainText('GS-01');
 await page.locator('#closeInspect').click();
 await expect(page.locator('#inspectDialog')).toBeHidden();
});

test('local Duel shows a live projected ship and route for every movement step without committing its actual position',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/local-battle.html?scenario=duel&asteroids=off&seed=1984');
 const snapshot=()=>page.evaluate(()=>({
  ship:window.__localBattleTest.state().ships.host,
  map:document.getElementById('map').toDataURL(),
  preview:document.getElementById('preview').textContent,
  chips:document.getElementById('moveChips').textContent
 }));
 const initial=await snapshot();
 for(const [button,plan] of [['addF','F'],['addL','FL'],['addR','FLR']]){
  await page.locator('#'+button).click();
  await expect(page.locator('#plan')).toHaveValue(plan);
  await expect(page.locator('#preview')).toContainText('END HEX');
  await expect(page.locator('#moveChips')).toContainText(plan.length+' ·');
  const current=await snapshot();
  expect(current.map).not.toBe(initial.map);
  expect([current.ship.q,current.ship.r,current.ship.d]).toEqual([initial.ship.q,initial.ship.r,initial.ship.d]);
 }
 await page.locator('#undoPlan').click();
 await expect(page.locator('#plan')).toHaveValue('FL');
 await page.locator('#clearPlan').click();
 await expect(page.locator('#plan')).toHaveValue('');
 const cleared=await snapshot();
 expect(cleared.map).toBe(initial.map);
 await page.locator('#addF').click();
 await page.locator('#submit').click();
 const committed=await page.evaluate(()=>window.__localBattleTest.state());
 expect(committed.ships.host.q).not.toBe(initial.ship.q);
 await expect(page.locator('#targetingPanel')).toBeVisible();
 expect(errors).toEqual([]);
});
