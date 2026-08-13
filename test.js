/* STAKKA 3 headless logic test — node Stakka3/test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const probed = src.replace(
  /\}\)\(\);\s*$/,
  `globalThis.__T = {
    get state(){return state}, get blocks(){return blocks}, get mover(){return mover},
    get obstacles(){return obstacles}, get combo(){return combo}, get score(){return score},
    get currentLevel(){return currentLevel}, get maxLevel(){return maxLevel}, get debris(){return debris},
    get collapseLevel(){return collapseLevel}, get dangerFrac(){return dangerFrac}, get overCause(){return overCause},
    get lava(){return lava}, LAVA_MIN_LEVEL,
    GOAL, LV, update, render, place, tap, startGame, retryLevel, restartFrom1, spawnObs, inDanger,
    w2s, topCenterScreen, moverExt, snapCam
   };
})();`
);

/* ── DOM stubs ── */
const noop = () => {};
const ctxStub = new Proxy({}, { get(_, k) {
  if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
  return typeof k === 'string' ? noop : undefined;
}, set() { return true; } });
const canvas = { getContext: () => ctxStub, style:{}, width:0, height:0, clientWidth:393, clientHeight:852 };
const mkEl = () => ({ style:{}, textContent:'', innerHTML:'', className:'', classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, toggle(c,v){v?this._s.add(c):this._s.delete(c);}, contains(c){return this._s.has(c);} }, addEventListener:noop, appendChild(){return {};}, closest(){return null;} });
const els = {}, store = new Map();
const sandbox = {
  console,
  document: { hidden:false, createElement:()=>mkEl(), getElementById: id => id==='c'?canvas:(els[id]||(els[id]=mkEl())), addEventListener:noop },
  localStorage: { getItem:k=>store.has(k)?store.get(k):null, setItem:(k,v)=>store.set(k,v) },
  navigator:{}, performance:{ now:()=>Date.now() }, requestAnimationFrame: fn=>{ /* no auto-run */ },
  setTimeout: fn=>{ fn(); return 0; },
  innerWidth:393, innerHeight:852, devicePixelRatio:2, addEventListener:noop,
  AudioContext: undefined, visualViewport: null
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox); vm.runInContext(probed, sandbox);
const T = sandbox.__T;

let pass=0, failN=0;
const ok = (c,msg)=>{ if(c){pass++;} else {failN++; console.log('  FAIL: '+msg);} };
const align = ()=>{ if(!T.mover) return; const p=T.blocks[T.blocks.length-1]; if(T.mover.axis==='x') T.mover.x=p.x; else T.mover.z=p.z; };
const clearObs = ()=>{ T.obstacles.length = 0; };

/* 1. 시작 */
ok(T.state==='menu','boot → menu');
T.startGame();
ok(T.state==='play','startGame → play');
ok(T.currentLevel===1,'level 1');
ok(T.score===0,'score 0');
ok(T.mover!==null,'mover spawned');
ok(T.dangerFrac===0,'danger starts at 0');
ok(T.score - T.collapseLevel > 0,'collapse starts below the tower (positive gap)');

/* 2. 레벨1 클리어(장애물 없음, 순간 배치라 붕괴선은 안 움직임) → 레벨2 */
for (let i=0;i<T.GOAL;i++){ align(); clearObs(); T.place(); }
ok(T.currentLevel===2,'6 placements clear level 1 → level 2');
ok(T.score===6,'score 6');
ok(T.state==='play','still playing after clearing level 1');

/* 3. 장애물이 덮칠 때 place → hitFail(over), 원인 표기 */
const me = T.moverExt();
T.obstacles.push({ e:'🦇', pat:'fly', t:1, sz:56, active:true, hitW:44, x:me.cx, y:T.topCenterScreen().y });
ok(T.inDanger()!==null,'inDanger detects obstacle over mover');
T.place();
ok(T.state==='over','placing under obstacle → game over');
ok(T.overCause==='hit','over cause is hit (obstacle), not collapse or misplacement');
ok(T.mover===null,'mover cleared on hit');

/* 4. 체크포인트 재시작 — 현재 레벨(2) 기초부터, 붕괴선도 새 여유로 재생성 */
T.retryLevel();
ok(T.state==='play','retryLevel → play');
ok(T.currentLevel===2,'retry keeps current level (checkpoint)');
ok(T.score===(2-1)*T.GOAL,'retry rebuilds foundation to level start height');
ok(T.mover!==null,'mover respawned after retry');
ok(T.score - T.collapseLevel > 0,'collapse gap positive right after retry');

/* 5. 장애물이 없으면 대기는 안전하다 — place 정상 동작 */
clearObs(); align(); T.place();
ok(T.state==='play','safe placement when no obstacle');

/* 6. 장애물 자동 스폰 동작 (obs / obs2 겸용 시그니처) */
const cfg = T.LV[T.currentLevel-1].obs;
if (cfg) {
  const before = T.obstacles.length;
  T.spawnObs(cfg);
  ok(T.obstacles.length === before+1, 'spawnObs adds obstacle');
  ok(T.obstacles[T.obstacles.length-1].e === cfg.e, 'spawned obstacle matches level config');
}

/* 6b. 레벨 5 이상에서 해저 화산이 실제로 분출한다 (순수 연출 — 데미지 없음) */
T.restartFrom1();
clearObs();
{
  // 레벨 5까지는 순간 배치라 시간이 안 걸린다 → 붕괴선 걱정 없이 바로 도달
  while (T.currentLevel < T.LAVA_MIN_LEVEL && T.state === 'play') { align(); clearObs(); T.place(); }
  ok(T.currentLevel === T.LAVA_MIN_LEVEL, 'reached lava-enabled level via placements');
  ok(T.lava.length === 0, 'no lava particles below level ' + T.LAVA_MIN_LEVEL);
  let guard = 0;
  while (T.lava.length === 0 && guard++ < 400) { clearObs(); T.update(1/60); }
  ok(T.lava.length > 0, 'eruption spawns lava particles once in the lava-enabled level');
  ok(T.state === 'play', 'eruption does not end the game (cosmetic only)');
}

/* 7. 붕괴선이 따라잡으면 즉시 게임오버 (idle, 시간 경과만으로) */
T.restartFrom1();
clearObs();
{
  let guard = 0;
  while (T.state === 'play' && guard++ < 500) { clearObs(); T.update(1); }
  ok(T.state==='over','idling long enough lets the collapse line catch up');
  ok(T.overCause==='collapse','over cause is collapse when caught by the void, not obstacle/misplacement');
}

/* 8. 레벨을 올려가며 10레벨 도달 → 탈출(승리). place() 는 시간(update)을 소비하지 않으므로
      붕괴선이 방해하지 않는다 — 순수 스태킹 로직만 검증한다. */
T.restartFrom1();
clearObs();
let guard=0;
while (T.state==='play' && guard++ < 200) {
  align(); clearObs(); T.place();
}
ok(T.state==='win','reaching height 60 → win');
ok(T.maxLevel===10,'maxLevel saved as 10');

/* 9. 승리 후 재시작 */
T.restartFrom1();
ok(T.state==='play','restartFrom1 after win');
ok(T.currentLevel===1,'restart from level 1');
ok(T.score===0,'restart score 0');

/* 10. 렌더 무결성 (붕괴선/비네트 포함) */
clearObs();
for (let i=0;i<3;i++){ align(); T.place(); }
for (let i=0;i<60;i++) T.update(1/60);
T.render();
ok(true,'render runs without throwing');

/* 11. 장애물 타입별 스폰이 에러 없이 동작 (obs / obs2) */
for (let lv=1; lv<=10; lv++) {
  const c = T.LV[lv-1];
  if (c.obs)  ok(typeof c.obs.e==='string'  && c.obs.e.length>0,  'LV'+lv+' obs has emoji');
  if (c.obs2) ok(typeof c.obs2.e==='string' && c.obs2.e.length>0, 'LV'+lv+' obs2 has emoji');
}
ok(T.LV[9].obs2 !== undefined, 'final level (10) has a dual hazard (obs2) for the boss-like finale');

console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN?1:0);
