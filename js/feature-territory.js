/* ============================================
   領地佔領戰
   ────────────────────────────────────────────
   分組後才能玩。答對題目累積佔領分,在戰役時間內分數最高的一組
   拿下那塊地。地圖由外圍往內陸分階段開放。

   為什麼沒有裁判?
   地圖不是誰寫出來的,而是「重播」出來的 ——
   每個人都拿到同一份作答事件,依伺服器時間排序後跑同一套規則,
   必然得到同一張地圖。老師不用開著頁面,學生之間也不會打架,
   先後順序由伺服器時間決定,不受各自裝置的時鐘影響。

   那怎麼防止亂寫?兩道防線各司其職:
     · 安全規則:比對老師事先設定好的正確答案,答錯的事件根本寫不進來,
       組別與佔領分也由規則從伺服器端的資料核對。正確答案存在學生
       讀不到的文件裡,但規則讀得到。
     · 重播規則:相鄰、開放階段、基地保護、戰役時間都在重播時判定。
       就算有人硬塞一筆不合規的事件,重播時也會被忽略。

   地圖本身不存進資料庫,只存「形狀 + 大小 + 亂數種子」,
   由同一套產生器算出來 —— 兩千格的地圖也只佔幾十位元組。
============================================ */

/* ---------- 可重現的亂數 ----------
   地圖必須在每台裝置上長得一模一樣,所以不能用 Math.random。
   給同一個種子就永遠得到同一串數字。 */

function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 六角格座標 ----------
   axial 座標 (q, r),尖角朝上。六個鄰居方向固定,
   不像 offset 座標要為奇偶列分開處理,相鄰判斷不會寫錯。 */

const HEX_DIRECTIONS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]
];

const Hex = {
  key(q, r) { return `${q}_${r}`; },

  parse(key) {
    const [q, r] = key.split('_').map(Number);
    return { q, r };
  },

  neighbors(q, r) {
    return HEX_DIRECTIONS.map(([dq, dr]) => this.key(q + dq, r + dr));
  },

  /* 離中心幾圈 */
  ring(q, r) {
    return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
  },

  distance(a, b) {
    const A = this.parse(a), B = this.parse(b);
    return (Math.abs(A.q - B.q) + Math.abs(A.q + A.r - B.q - B.r) + Math.abs(A.r - B.r)) / 2;
  },

  toPixel(q, r, size) {
    return { x: size * Math.sqrt(3) * (q + r / 2), y: size * 1.5 * r };
  },

  corners(cx, cy, size) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 90);
      pts.push(`${(cx + size * Math.cos(a)).toFixed(1)},${(cy + size * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(' ');
  }
};

/* 世界地圖的輪廓。# 是陸地,. 是海洋。
   刻意畫得粗略 —— 取樣到六角格之後,細節本來就會消失,
   保留得出來的是各大洲的相對位置與大小。 */
const WORLD_ART = [
  '..........................................................',
  '.....####.......#####.................############........',
  '....########...#######..........##..###############.......',
  '...##########..######..........#################......###.',
  '...###########.####...........##################.....#####',
  '....##########................##################......###.',
  '.....#########...............###################..........',
  '......########...............####################.........',
  '.......######.................##################..........',
  '........#####..........########..###############..........',
  '.........###...........########..#####...#######..........',
  '..........#............#########..###.....#####...........',
  '.........###...........##########.........####............',
  '........#####..........##########..........##.............',
  '.......######..........##########.........................',
  '.......######...........#########.............####........',
  '......#######............########............########.....',
  '......######..............#######............#########....',
  '.....######................######.............#######.....',
  '.....#####..................#####..............#####......',
  '.....####....................###................###.......',
  '.....###......................#...........................',
  '......#...................................................',
  '..........................................................'
];

/* ============================================
   地圖形狀
   ────────────────────────────────────────────
   每個產生器吃 (radius, seed) 回傳格子清單。
   全部都是純函式 —— 同樣的輸入永遠得到同樣的地圖。
============================================ */

const MAP_SHAPES = {

  hexagon: {
    name: '六角大陸', desc: '最平衡的形狀,各組推進距離相同',
    build(radius) {
      const cells = [];
      for (let q = -radius; q <= radius; q++) {
        const r1 = Math.max(-radius, -q - radius);
        const r2 = Math.min(radius, -q + radius);
        for (let r = r1; r <= r2; r++) cells.push(Hex.key(q, r));
      }
      return cells;
    }
  },

  rectangle: {
    name: '橫向大陸', desc: '東西狹長,適合兩軍對峙',
    build(radius) {
      const cells = [];
      const h = Math.round(radius * 1.1), w = Math.round(radius * 2.0);
      for (let r = -h; r <= h; r++) {
        const offset = -Math.floor(r / 2);
        for (let q = offset - w; q <= offset + w; q++) cells.push(Hex.key(q, r));
      }
      return cells;
    }
  },

  ring: {
    name: '環形群島', desc: '中央是海,只能沿著環推進',
    build(radius) {
      const inner = Math.floor(radius * 0.42);
      return MAP_SHAPES.hexagon.build(radius).filter(k => {
        const { q, r } = Hex.parse(k);
        return Hex.ring(q, r) > inner;
      });
    }
  },

  cross: {
    name: '十字要塞', desc: '四條走廊交會於中心,中央是兵家必爭之地',
    build(radius) {
      const arm = Math.max(1, Math.round(radius * 0.34));
      return MAP_SHAPES.hexagon.build(radius).filter(k => {
        const { q, r } = Hex.parse(k);
        const s = -q - r;
        return Math.abs(q) <= arm || Math.abs(r) <= arm || Math.abs(s) <= arm;
      });
    }
  },

  star: {
    name: '星形大陸', desc: '六個尖角,各組從角落起家',
    build(radius) {
      return MAP_SHAPES.hexagon.build(radius).filter(k => {
        const { q, r } = Hex.parse(k);
        const s = -q - r;
        const d = Hex.ring(q, r);
        if (d <= radius * 0.45) return true;
        // 留下三軸附近的尖角,其餘挖掉
        const nearAxis = Math.min(Math.abs(q), Math.abs(r), Math.abs(s));
        return nearAxis <= radius * 0.22;
      });
    }
  },

  islands: {
    name: '破碎群島', desc: '不規則島嶼與海灣,推進路線每一局都不同',
    build(radius, seed) {
      const rand = seededRandom(seed || 1);
      const base = MAP_SHAPES.hexagon.build(radius);

      // 撒下若干「島核」,離島核夠近的格子成為陸地
      const coreCount = Math.max(5, Math.round(radius * 1.6));
      const cores = [];
      for (let i = 0; i < coreCount; i++) {
        const ang = rand() * Math.PI * 2;
        const dist = Math.sqrt(rand()) * radius * 0.92;
        cores.push({
          q: Math.round(Math.cos(ang) * dist),
          r: Math.round(Math.sin(ang) * dist),
          rad: radius * (0.18 + rand() * 0.22)
        });
      }

      const land = base.filter(k => {
        const { q, r } = Hex.parse(k);
        return cores.some(c =>
          Hex.distance(k, Hex.key(c.q, c.r)) <= c.rad);
      });

      // 島嶼之間必須走得到,否則有的組會被困在孤島上
      return MAP_SHAPES._connect(land, base, rand);
    }
  },

  cave: {
    name: '洞窟迷宮', desc: '蜿蜒的通道與死路,適合長期戰',
    build(radius, seed) {
      const rand = seededRandom(seed || 1);
      const base = MAP_SHAPES.hexagon.build(radius);
      const set = new Set(base);

      // 隨機挖掉一部分,再補上連通性 —— 得到有機的洞窟輪廓
      const wall = new Set();
      base.forEach(k => {
        const { q, r } = Hex.parse(k);
        const edge = Hex.ring(q, r) > radius - 1;
        if (!edge && rand() < 0.34) wall.add(k);
      });

      const land = base.filter(k => !wall.has(k));
      return MAP_SHAPES._connect(land, base, rand);
    }
  },

  world: {
    name: '世界地圖', desc: '七大洲輪廓,大陸之間以陸橋相連',
    build(radius) {
      // 用一張輪廓圖取樣。# 是陸地,. 是海洋。
      // 解析度固定,再依 radius 縮放到需要的格數。
      const art = WORLD_ART;
      const artH = art.length, artW = art[0].length;

      const h = Math.round(radius * 1.15);
      const w = Math.round(radius * 2.1);
      const cells = [];

      for (let row = -h; row <= h; row++) {
        const offset = -Math.floor(row / 2);
        for (let col = -w; col <= w; col++) {
          // 把 (col,row) 映到輪廓圖的座標
          const ax = Math.floor((col + w) / (2 * w + 1) * artW);
          const ay = Math.floor((row + h) / (2 * h + 1) * artH);
          const line = art[Math.min(artH - 1, Math.max(0, ay))];
          if (line[Math.min(artW - 1, Math.max(0, ax))] === '#') {
            cells.push(Hex.key(offset + col, row));
          }
        }
      }

      // 各大洲本來就分離,補上陸橋才不會有組被困在自己的洲
      return MAP_SHAPES._connect(cells, cells, seededRandom(1));
    }
  },

  /* 把不相連的區塊接起來。
     不連通的地圖會讓某些組被困在孤島上,整局動彈不得,
     所以這一步是必要的,不是美化。 */
  _connect(land, universe, rand) {
    let set = new Set(land);

    // 最多修幾輪。正常一兩輪就收斂,這只是避免萬一無限迴圈
    for (let round = 0; round < 40; round++) {
      const blobs = this._components(set);
      if (blobs.length <= 1) break;

      blobs.sort((a, b) => b.length - a.length);
      const main = blobs[0];
      const mainSet = new Set(main);

      for (let i = 1; i < blobs.length; i++) {
        const blob = blobs[i];
        // 太小的碎島直接丟掉,不值得為它挖路
        if (blob.length < 3) {
          blob.forEach(k => set.delete(k));
          continue;
        }
        // 用重心找出大概方向,再各自取最近的一格 —— 避免兩兩比對的 O(n²)
        const c = this._centroid(blob);
        const anchor = this._nearest(main, c);
        const from = this._nearest(blob, Hex.parse(anchor));
        this._carve(set, from, anchor);
        blob.forEach(k => mainSet.add(k));
      }
    }

    return [...set];
  },

  _components(set) {
    const seen = new Set();
    const blobs = [];
    set.forEach(start => {
      if (seen.has(start)) return;
      const blob = [];
      const queue = [start];
      seen.add(start);
      while (queue.length) {
        const k = queue.pop();
        blob.push(k);
        const { q, r } = Hex.parse(k);
        Hex.neighbors(q, r).forEach(n => {
          if (set.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
        });
      }
      blobs.push(blob);
    });
    return blobs;
  },

  _centroid(cells) {
    let q = 0, r = 0;
    cells.forEach(k => { const p = Hex.parse(k); q += p.q; r += p.r; });
    return { q: q / cells.length, r: r / cells.length };
  },

  _nearest(cells, point) {
    let best = null, bestD = Infinity;
    cells.forEach(k => {
      const p = Hex.parse(k);
      // 立方座標下的距離,不用開根號也準確
      const d = (Math.abs(p.q - point.q) + Math.abs(p.r - point.r)
               + Math.abs(p.q + p.r - point.q - point.r)) / 2;
      if (d < bestD) { bestD = d; best = k; }
    });
    return best;
  },

  /* 沿六角格的直線挖出一條走廊。
     用立方座標內插再取整,每一步都保證相鄰,不會跳格 —— 
     這是前一版用平面內插造成地圖斷開的原因。 */
  _carve(set, fromKey, toKey) {
    const A = Hex.parse(fromKey), B = Hex.parse(toKey);
    const a = { x: A.q, y: A.r, z: -A.q - A.r };
    const b = { x: B.q, y: B.r, z: -B.q - B.r };
    const N = Math.max(1, (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z)) / 2);

    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = this._cubeRound(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t
      );
      set.add(Hex.key(p.x, p.y));
    }
  },

  /* 立方座標取整:三個軸各自四捨五入後,把誤差最大的那一軸
     反推回來,確保 x + y + z 仍然等於 0 */
  _cubeRound(x, y, z) {
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    return { x: rx, y: ry, z: rz };
  }
};

/* 地圖規模。半徑決定格子數,實際數量依形狀而異 */
const MAP_SIZES = [
  { id: 'S',  label: '小',   radius: 6,  note: '一節課' },
  { id: 'M',  label: '中',   radius: 10, note: '幾節課' },
  { id: 'L',  label: '大',   radius: 15, note: '一個月' },
  { id: 'XL', label: '超大', radius: 21, note: '一學期' },
  { id: 'XXL',label: '史詩', radius: 26, note: '一學年' }
];

const GROUP_COLORS = [
  '#c25b4e', '#4a7c62', '#5b8ba8', '#c8a44d',
  '#8a5a72', '#d97742', '#6b7f4a', '#7a6aa8'
];

const DIFFICULTY = {
  easy:   { label: '簡單', points: 1, color: '#7d9b8a' },
  medium: { label: '普通', points: 2, color: '#c8a44d' },
  hard:   { label: '困難', points: 3, color: '#c25b4e' }
};

/* ============================================
   遊戲引擎
============================================ */

const Territory = {

  /* 產生地圖格子。config 只存形狀與種子,格子每次算出來 */
  cellsOf(config) {
    const shape = MAP_SHAPES[config.shape] || MAP_SHAPES.hexagon;
    return shape.build(config.radius, config.seed || 1);
  },

  /* ---------- 開局設定 ---------- */

  createConfig(groups, opts) {
    const shape = MAP_SHAPES[opts.shape] ? opts.shape : 'hexagon';
    const radius = opts.radius || 10;
    const seed = opts.seed || (Date.now() % 2147483647);
    const cells = MAP_SHAPES[shape].build(radius, seed);

    // 挑基地時用「離地圖邊界幾步」,基地才會落在外圍
    const borderDepth = this.computeDepth(cells);
    const bases = {};
    this.pickStarts(cells, borderDepth, groups.length).forEach((key, i) => {
      if (key) bases[key] = i;
    });

    // 開放範圍則用「離最近基地幾步」
    const baseDist = this.computeBaseDist(cells, Object.keys(bases));
    const maxDepth = Math.max(...Object.values(baseDist));

    const memberGroup = {};
    groups.forEach((members, i) => {
      (members || []).forEach(m => {
        const id = typeof m === 'string' ? m : (m && m.id);
        if (id) memberGroup[id] = i;
      });
    });

    return {
      shape, radius, seed, maxDepth,
      threshold: opts.threshold || 5,           // 拿下一格至少要累積幾分
      battleSeconds: opts.battleSeconds || 90,  // 一場地塊爭奪持續多久
      stageMode: opts.stageMode || 'auto',      // auto = 依倒數自動開放 / manual = 老師手動
      stageSeconds: opts.stageSeconds || 300,   // 自動模式下每階段的間隔
      openDepth: 1,                             // 手動模式用:已開放到第幾層
      overrides: {},                            // 老師個別指定 { hexKey: true=開放 / false=封鎖 }
      groupCount: groups.length,
      bases, memberGroup,
      status: 'running',
      startedAt: Date.now()
    };
  },

  /* ---------- 內陸深度 ----------
     從地圖外緣往內做 BFS,每一格記下離邊界幾步。
     用這個取代原本的「第幾圈」,任何形狀都適用 ——
     不規則地圖也能正確地由外往內開放。 */

  computeDepth(cells) {
    const set = new Set(cells);
    const depth = {};
    const queue = [];

    cells.forEach(k => {
      const { q, r } = Hex.parse(k);
      // 六個鄰居沒住滿就是邊界
      const isEdge = Hex.neighbors(q, r).some(n => !set.has(n));
      if (isEdge) { depth[k] = 0; queue.push(k); }
    });

    for (let i = 0; i < queue.length; i++) {
      const k = queue[i];
      const { q, r } = Hex.parse(k);
      Hex.neighbors(q, r).forEach(n => {
        if (set.has(n) && depth[n] === undefined) {
          depth[n] = depth[k] + 1;
          queue.push(n);
        }
      });
    }
    return depth;
  },

  /* ---------- 離最近基地幾步 ----------
     開放範圍是從各組的起始基地往外擴散,不是從地圖外緣往內。
     從地圖邊緣開放的話,基地靠邊的組一開始就有一大片空地可拿,
     靠內陸的組卻無處可去 —— 不公平。從基地擴散則每一組
     在每個階段能碰到的格子數大致相同。 */

  computeBaseDist(cells, baseKeys) {
    const set = new Set(cells);
    const dist = {};
    const queue = [];

    baseKeys.forEach(k => {
      if (set.has(k)) { dist[k] = 0; queue.push(k); }
    });

    for (let i = 0; i < queue.length; i++) {
      const k = queue[i];
      const { q, r } = Hex.parse(k);
      Hex.neighbors(q, r).forEach(n => {
        if (set.has(n) && dist[n] === undefined) {
          dist[n] = dist[k] + 1;
          queue.push(n);
        }
      });
    }

    // 走不到的格子(理論上不該有,連通修復已經處理過)當成最遠
    let max = 0;
    Object.values(dist).forEach(d => { if (d > max) max = d; });
    cells.forEach(k => { if (dist[k] === undefined) dist[k] = max + 1; });

    return dist;
  },

  /* 距離表每次重播都要用,但只跟地圖與基地有關,算一次就好 */
  depthOf(config) {
    const key = `${config.shape}_${config.radius}_${config.seed}_${Object.keys(config.bases || {}).join()}`;
    if (this._depthCache && this._depthCache.key === key) return this._depthCache.depth;
    const depth = this.computeBaseDist(this.cellsOf(config), Object.keys(config.bases || {}));
    this._depthCache = { key, depth };
    return depth;
  },

  /* ---------- 起始基地 ----------
     從最外緣挑,並且盡量互相遠離。用貪婪的最遠點取樣:
     先挑一個,之後每次挑「離已選點最遠」的那一格。
     這對任何形狀都有效,不像照角度排序只適用於規則圖形。 */

  pickStarts(cells, depth, groupCount) {
    const edge = cells.filter(k => depth[k] === 0);
    if (edge.length === 0) return cells.slice(0, groupCount);

    const picked = [edge[0]];
    while (picked.length < groupCount) {
      let best = null, bestD = -1;
      edge.forEach(k => {
        if (picked.includes(k)) return;
        const d = Math.min(...picked.map(p => Hex.distance(k, p)));
        if (d > bestD) { bestD = d; best = k; }
      });
      if (!best) break;
      picked.push(best);
    }
    return picked;
  },

  /* ---------- 階段開放 ----------
     由外緣往內陸開。自動模式由經過的時間算出來,
     不需要任何人定時寫資料 —— 每台裝置各自算,結果一樣。 */

  openDepthAt(config, atTime) {
    if (config.stageMode === 'manual') return config.openDepth || 1;
    const elapsed = Math.max(0, (atTime - config.startedAt) / 1000);
    return Math.min(config.maxDepth + 1, 1 + Math.floor(elapsed / config.stageSeconds));
  },

  /* 某一格現在開放了嗎?
     老師個別指定的優先於階段開放 —— 他可以提早開放某片區域,
     也可以把已經到期的區域鎖起來當禁區。 */
  isOpenCell(config, hexKey, depth, atTime) {
    const ov = config.overrides && config.overrides[hexKey];
    if (ov === true) return true;
    if (ov === false) return false;
    return depth <= this.openDepthAt(config, atTime);
  },

  nextStageAt(config) {
    if (config.stageMode === 'manual') return null;
    const d = this.openDepthAt(config, Date.now());
    if (d > config.maxDepth) return null;
    return config.startedAt + d * config.stageSeconds * 1000;
  },

  /* ---------- 重播 ----------
     events 必須已依伺服器時間排序。 */

  replay(config, events, now) {
    now = now || Date.now();
    const depth = this.depthOf(config);

    const map = {};
    this.cellsOf(config).forEach(k => {
      map[k] = { owner: null, battle: null, depth: depth[k] || 0 };
    });
    Object.entries(config.bases || {}).forEach(([k, g]) => {
      if (map[k]) { map[k].owner = Number(g); map[k].isBase = true; }
    });
    // 快照:壓縮過的戰況。從這裡起算,快照之前的事件不必再重播
    Object.entries(config.snapshot || {}).forEach(([k, g]) => {
      if (map[k]) map[k].owner = Number(g);
    });

    const log = [];
    // 只追蹤交戰中的格子。地圖上千格時,每筆事件都掃全圖會慢到不能用
    const active = new Set();

    (events || []).forEach(ev => {
      const at = ev.at;
      this.resolveBattles(config, map, active, at, log);

      const cell = map[ev.hexKey];
      if (!cell) return;                                          // 不存在的格子
      if (cell.isBase) return;                                    // 基地不可攻佔
      if (cell.owner === ev.groupIdx) return;                     // 自己的地不用打
      if (!this.isOpenCell(config, ev.hexKey, cell.depth, at)) return;  // 還沒開放
      if (!this.adjacentTo(map, ev.hexKey, ev.groupIdx)) return;  // 必須與自己領地相鄰

      if (!cell.battle) {
        cell.battle = { endsAt: at + config.battleSeconds * 1000, points: {} };
        active.add(ev.hexKey);
      }
      const g = String(ev.groupIdx);
      cell.battle.points[g] = (cell.battle.points[g] || 0) + ev.points;
    });

    this.resolveBattles(config, map, active, now, log);

    return { map, log };
  },

  /* 結算已到期的戰役。達到門檻且分數最高的一組拿下;
     同分或都沒達標就沒人拿到,地塊維持原狀。 */
  resolveBattles(config, map, active, atTime, log) {
    if (active.size === 0) return;
    const done = [];

    active.forEach(k => {
      const cell = map[k];
      if (!cell || !cell.battle || cell.battle.endsAt > atTime) return;
      done.push(k);

      const ranked = Object.entries(cell.battle.points)
        .map(([g, p]) => ({ groupIdx: Number(g), points: p }))
        .filter(e => e.points >= config.threshold)
        .sort((a, b) => b.points - a.points);

      const tied = ranked[1] && ranked[1].points === ranked[0].points;

      if (ranked.length > 0 && !tied) {
        log.push({
          at: cell.battle.endsAt, hexKey: k,
          from: cell.owner, to: ranked[0].groupIdx, points: ranked[0].points
        });
        cell.owner = ranked[0].groupIdx;
      } else if (ranked.length > 0) {
        log.push({ at: cell.battle.endsAt, hexKey: k, draw: true });
      }
      cell.battle = null;
    });

    done.forEach(k => active.delete(k));
  },

  adjacentTo(map, hexKey, groupIdx) {
    const { q, r } = Hex.parse(hexKey);
    return Hex.neighbors(q, r).some(n => map[n] && map[n].owner === groupIdx);
  },

  /* ---------- 查詢 ---------- */

  targetsFor(config, map, groupIdx, now) {
    now = now || Date.now();
    const targets = new Set();
    Object.keys(map).forEach(k => {
      if (map[k].owner !== groupIdx) return;
      const { q, r } = Hex.parse(k);
      Hex.neighbors(q, r).forEach(n => {
        const t = map[n];
        if (!t || t.owner === groupIdx || t.isBase) return;
        if (!this.isOpenCell(config, n, t.depth, now)) return;
        targets.add(n);
      });
    });
    return targets;
  },

  standings(config, map) {
    const counts = Array.from({ length: config.groupCount }, () => 0);
    Object.values(map).forEach(c => {
      if (c.owner !== null && counts[c.owner] !== undefined) counts[c.owner]++;
    });
    return counts
      .map((count, groupIdx) => ({ groupIdx, count }))
      .sort((a, b) => b.count - a.count);
  },

  /* 把目前的戰況壓成一份快照:每格只留擁有者,交戰中的格子不收
     (它們還沒結算,壓縮後會從頭開始,這是刻意的取捨 —— 壓縮前
      老師會先看到提示)。回傳的物件小到可以直接放進設定裡。 */
  snapshotOf(map) {
    const snap = {};
    Object.entries(map).forEach(([k, cell]) => {
      if (cell.owner !== null && !cell.isBase) snap[k] = cell.owner;
    });
    return snap;
  },

  /* 畫面用的指紋。地圖上千格時,沒變就不該重繪 */
  signature(config, map, now) {
    const parts = [this.openDepthAt(config, now || Date.now()),
                   JSON.stringify(config.overrides || {})];
    Object.keys(map).forEach(k => {
      const c = map[k];
      if (c.owner !== null) parts.push(k + ':' + c.owner);
      if (c.battle) {
        parts.push(k + '!' + Object.entries(c.battle.points).map(e => e.join('')).join(''));
      }
    });
    return parts.join('|');
  }
};

/* ============================================
   地圖繪製(老師端與學生端共用)
============================================ */

/* 大地圖有上千格,重繪成本高。指紋沒變就整段跳過。 */
let _lastMapSig = null;

/* 捲動位置要跨重繪保留。
   地圖每秒會因為戰況更新而重畫,如果不記住捲動位置,學生一放大想看別的地方
   就會被彈回原點,根本沒辦法看地圖。
   重繪的 innerHTML 由呼叫端負責,所以這裡排一個 microtask,等新的 DOM 進去了再還原。
   捲動幅度也要一起記:縮放後畫布變大變小,用比例還原才會停在同一塊地。 */
let _hexScroll = { l: 0, t: 0, w: 0, h: 0 };
let _hexScrollLock = false;

function _hexScrollSave(el) {
  if (_hexScrollLock) return;
  _hexScroll = {
    l: el.scrollLeft, t: el.scrollTop,
    w: Math.max(1, el.scrollWidth - el.clientWidth),
    h: Math.max(1, el.scrollHeight - el.clientHeight)
  };
}

function _hexScrollRestore() {
  const el = document.querySelector('.hex-map-scroll');
  if (!el || (!_hexScroll.l && !_hexScroll.t)) return;
  const w = Math.max(1, el.scrollWidth - el.clientWidth);
  const h = Math.max(1, el.scrollHeight - el.clientHeight);
  _hexScrollLock = true;                       // 還原本身會觸發 onscroll,別讓它蓋掉紀錄
  el.scrollLeft = (_hexScroll.l / _hexScroll.w) * w;
  el.scrollTop  = (_hexScroll.t / _hexScroll.h) * h;
  _hexScrollLock = false;
}

function renderHexMap(config, map, opts) {
  const o = opts || {};
  // microtask 通常就緊接在 innerHTML 之後,不會閃;若呼叫端中間有 await
  // 導致那時 DOM 還沒進去,再用 rAF 補一次。
  Promise.resolve().then(_hexScrollRestore);
  requestAnimationFrame(_hexScrollRestore);
  const now = Date.now();
  const size = 26;
  const cells = Object.keys(map);

  const pos = {};
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  cells.forEach(k => {
    const { q, r } = Hex.parse(k);
    const p = Hex.toPixel(q, r, size);
    pos[k] = p;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });
  const pad = size * 1.4;
  const vw = (maxX - minX) + pad * 2;
  const vh = (maxY - minY) + pad * 2;
  const vb = [minX - pad, minY - pad, vw, vh];

  const targets = o.groupIdx != null
    ? Territory.targetsFor(config, map, o.groupIdx, now) : new Set();
  const editing = !!o.editMode;
  const selected = o.selected || new Set();

  const polys = cells.map(k => {
    const cell = map[k];
    const p = pos[k];
    const open = Territory.isOpenCell(config, k, cell.depth, now);
    const owned = cell.owner !== null;
    const canAttack = targets.has(k);
    const pts = Hex.corners(p.x, p.y, size);

    // 未開放的區域用深色石板 + 斜線紋,和「空白但可打」的淺色明顯區隔
    if (!open) {
      return `<g class="hex locked ${selected.has(k) ? 'picked' : ''}"
        ${editing ? `onclick="territoryPick('${k}')"` : ''}>
        <polygon points="${pts}" fill="#7d7368" stroke="#585047" stroke-width="1.5" />
        <polygon points="${pts}" fill="url(#lockHatch)" />
        ${selected.has(k) ? `<polygon points="${pts}" class="pick-ring" />` : ''}
      </g>`;
    }

    // 已開放但無人佔領的陸地。用暖草色而不是接近背景的米白,
    // 在深色海面上才看得出「這裡是可以搶的地」。
    const fill = owned ? GROUP_COLORS[cell.owner % GROUP_COLORS.length] : '#e3d9ae';

    let battleMarks = '';
    if (cell.battle) {
      const ranked = Object.entries(cell.battle.points)
        .map(([g, pts2]) => ({ g: Number(g), pts: pts2 }))
        .sort((a, b) => b.pts - a.pts);
      const total = ranked.reduce((s2, e) => s2 + e.pts, 0) || 1;
      let x = p.x - size * 0.62;
      battleMarks = ranked.map(e => {
        const w = (size * 1.24) * (e.pts / total);
        const rect = `<rect x="${x.toFixed(1)}" y="${(p.y + size * 0.42).toFixed(1)}"
          width="${w.toFixed(1)}" height="5" fill="${GROUP_COLORS[e.g % GROUP_COLORS.length]}" />`;
        x += w;
        return rect;
      }).join('') +
      `<text x="${p.x.toFixed(1)}" y="${(p.y + 5).toFixed(1)}" class="hex-battle-mark">⚔</text>`;
    }

    return `<g class="hex ${canAttack && !editing ? 'attackable' : ''} ${cell.isBase ? 'base' : ''}
                 ${cell.battle ? 'in-battle' : ''} ${selected.has(k) ? 'picked' : ''}"
      ${owned ? `data-owner="${cell.owner}"` : ''}
      ${canAttack ? 'data-attackable="1"' : ''}
      ${editing ? `onclick="territoryPick('${k}')"`
                : (canAttack && o.onClick ? `onclick="${o.onClick}('${k}')"` : '')}>
      <polygon points="${pts}" fill="${fill}" stroke="#fbf8f0" stroke-width="2" />
      ${cell.isBase ? `<text x="${p.x.toFixed(1)}" y="${(p.y + 6).toFixed(1)}" class="hex-base-mark">★</text>` : ''}
      ${battleMarks}
      ${selected.has(k) ? `<polygon points="${pts}" class="pick-ring" />` : ''}
    </g>`;
  }).join('');

  /* 大地圖放進可捲動的容器,並提供縮放。
     關鍵是用「地圖的原始尺寸」當 100%,不要硬塞進固定寬度 ——
     以前是 min(vw, 1100),於是半徑 15 的世界地圖被壓到 1100px 寬,
     每一格只剩十幾像素,學生根本看不清楚,也因為塞得下而完全不能捲動,
     「帶我回自己的領地」自然也就沒有意義。 */
  const zoom = o.zoom || 1;
  const width = Math.round(vw * zoom);

  return `
    <div class="hex-map-wrap">
      <div class="hex-map-tools">
        <button class="btn btn-ghost btn-small" onclick="territoryZoom(-1)">－</button>
        <span class="hex-zoom-label">${Math.round(zoom * 100)}%</span>
        <button class="btn btn-ghost btn-small" onclick="territoryZoom(1)">＋</button>
        <button class="btn btn-ghost btn-small" onclick="territoryFit()" title="縮到看得見整張地圖">整張</button>
        ${editing ? `
          <span class="hex-edit-count">已選 ${selected.size} 格</span>
          <button class="btn btn-primary btn-small" onclick="territoryApplyPick(true)">開放選取</button>
          <button class="btn btn-ghost btn-small" onclick="territoryApplyPick(false)">封鎖選取</button>
          <button class="btn btn-ghost btn-small" onclick="territoryApplyPick(null)">恢復自動</button>
          <button class="btn btn-ghost btn-small" onclick="TerritoryEdit.clear()">清除選取</button>
          <button class="btn btn-accent btn-small" onclick="TerritoryEdit.exit()">完成</button>
        ` : `
          <span class="hex-legend">
            <span class="lg lg-open"></span>空地
            <span class="lg lg-lock"></span>未開放
            <span class="lg lg-battle"></span>交戰中
            <span class="lg lg-sea"></span>海洋
          </span>`}
      </div>
      <div class="hex-map-scroll" onscroll="_hexScrollSave(this)">
        <svg class="hex-map" width="${width}" viewBox="${vb.join(' ')}"
             preserveAspectRatio="xMidYMid meet">
          <defs>
            <pattern id="lockHatch" width="7" height="7" patternUnits="userSpaceOnUse"
                     patternTransform="rotate(45)">
              <rect width="7" height="7" fill="rgba(0,0,0,0)" />
              <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(255,255,255,0.22)" stroke-width="3" />
            </pattern>
          </defs>
          ${polys}
        </svg>
      </div>
    </div>`;
}

/* 把畫面捲到某一組的領地中央。
   地圖動輒上千格,學生打開常常不知道自己在哪一角 —— 與其叫他們找,
   不如直接帶過去。用畫面實際座標算,不必再推一次六角座標。 */
function centerOnGroup(groupIdx, opts) {
  const box = document.querySelector('.hex-map-scroll');
  if (!box) return false;

  let marks = [...box.querySelectorAll(`.hex[data-owner="${groupIdx}"]`)];
  // 還沒佔到任何格子(或剛被打下來)就退而求其次,帶到可攻擊的地方
  if (marks.length === 0) marks = [...box.querySelectorAll('.hex[data-attackable="1"]')];
  if (marks.length === 0) return false;

  const bb = box.getBoundingClientRect();
  let sx = 0, sy = 0;
  marks.forEach(el => {
    const r = el.getBoundingClientRect();
    sx += r.left + r.width / 2;
    sy += r.top + r.height / 2;
  });
  const cx = sx / marks.length - bb.left + box.scrollLeft;
  const cy = sy / marks.length - bb.top + box.scrollTop;

  box.scrollTo({
    left: Math.max(0, cx - box.clientWidth / 2),
    top: Math.max(0, cy - box.clientHeight / 2),
    behavior: (opts && opts.instant) ? 'auto' : 'smooth'
  });
  _hexScrollSave(box);
  return true;
}

/* 縮放級距。上千格的地圖預設會縮得很小,放大才看得清楚 */
let _territoryZoom = 1;
function territoryZoom(dir) {
  // 下限放到 0.25:史詩尺寸的地圖要縮很多才看得到全貌
  const step = _territoryZoom <= 0.5 ? 0.125 : 0.25;
  _territoryZoom = Math.max(0.25, Math.min(4, _territoryZoom + dir * step));
  _territoryZoom = Math.round(_territoryZoom * 1000) / 1000;
  _lastMapSig = null;                       // 強制重繪
  if (typeof StudentApp !== 'undefined' && StudentApp.tab === 'war') StudentApp.render();
  else renderTerritoryLive();
}

/* 縮到整張地圖剛好看得見 */
function territoryFit() {
  const box = document.querySelector('.hex-map-scroll');
  const svg = box && box.querySelector('.hex-map');
  if (!box || !svg) return;
  const natural = svg.getBoundingClientRect().width / _territoryZoom;
  if (!natural) return;
  _territoryZoom = Math.max(0.25, Math.min(4,
    Math.floor((box.clientWidth - 8) / natural * 100) / 100));
  _lastMapSig = null;
  if (typeof StudentApp !== 'undefined' && StudentApp.tab === 'war') StudentApp.render();
  else renderTerritoryLive();
}

function renderStandings(config, map, highlightGroup) {
  const total = Object.keys(map).length;
  return `<div class="territory-standings">` +
    Territory.standings(config, map).map(s => {
      const pct = total > 0 ? (s.count / total * 100) : 0;
      const color = GROUP_COLORS[s.groupIdx % GROUP_COLORS.length];
      return `
        <div class="standing-row ${s.groupIdx === highlightGroup ? 'is-me' : ''}">
          <span class="standing-name" style="color:${color}">第 ${s.groupIdx + 1} 組</span>
          <span class="standing-bar">
            <span class="standing-fill" style="width:${pct}%; background:${color}"></span>
          </span>
          <span class="standing-count">${s.count}</span>
        </div>`;
    }).join('') + `</div>`;
}

/* 剩餘時間寫成 3:05 */
function formatCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ============================================
   老師端
============================================ */

function createTerritoryQuestion() {
  const text = document.getElementById('tqText').value.trim();
  const diff = document.getElementById('tqDifficulty').value;
  const opts = ['tqA', 'tqB', 'tqC', 'tqD'].map(id => document.getElementById(id).value.trim());
  const answer = parseInt(document.querySelector('input[name="tqAnswer"]:checked')?.value ?? '0');

  if (!text) { toast('請輸入題目'); return; }
  if (opts.filter(Boolean).length < 2) { toast('至少要有兩個選項'); return; }
  if (!opts[answer]) { toast('被標為正確答案的那一格是空的'); return; }

  state.territoryQuestions.unshift({
    id: 'tq_' + Date.now(), text, options: opts, answer,
    difficulty: diff, createdAt: Date.now()
  });

  document.getElementById('tqText').value = '';
  ['tqA', 'tqB', 'tqC', 'tqD'].forEach(id => { document.getElementById(id).value = ''; });

  save();
  renderTerritoryQuestions();
  publishTerritoryQuestions();
  toast(`已新增${DIFFICULTY[diff].label}題目`);
}

function deleteTerritoryQuestion(id) {
  state.territoryQuestions = state.territoryQuestions.filter(q => q.id !== id);
  save();
  renderTerritoryQuestions();
  publishTerritoryQuestions();
}

async function publishTerritoryQuestions() {
  if (!isCloudMode()) return;
  try {
    await Cloud.publishTerritoryQuestions(state.classId, state.territoryQuestions);
  } catch (e) {
    console.error('[領地戰] 題庫發布失敗:', e);
    toast('題庫同步失敗:' + e.message);
  }
}

function renderTerritoryQuestions() {
  const el = document.getElementById('tqList');
  if (!el) return;

  const qs = state.territoryQuestions;
  if (qs.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">◆</div><div>題庫是空的,先新增幾題</div></div>';
    return;
  }

  const byDiff = {};
  qs.forEach(q => { byDiff[q.difficulty] = (byDiff[q.difficulty] || 0) + 1; });

  el.innerHTML = `
    <div class="tq-summary">
      共 ${qs.length} 題 ·
      ${Object.entries(DIFFICULTY).map(([k, d]) =>
        `<span style="color:${d.color}">${d.label} ${byDiff[k] || 0}</span>`).join(' · ')}
    </div>` +
    qs.map(q => `
      <div class="tq-row">
        <span class="tq-diff" style="background:${DIFFICULTY[q.difficulty].color}">
          ${DIFFICULTY[q.difficulty].label} +${DIFFICULTY[q.difficulty].points}
        </span>
        <span class="tq-text">${escapeHtml(q.text)}</span>
        <span class="tq-answer">答:${'ABCD'[q.answer]}</span>
        <button class="btn btn-ghost btn-small" onclick="deleteTerritoryQuestion('${q.id}')">✕</button>
      </div>`).join('');
}

/* ---------- 開局 / 控制 ---------- */

async function startTerritoryGame() {
  if (!isCloudMode()) { toast('需要登入雲端才能進行領地戰'); return; }

  const groups = state.currentGroups && state.currentGroups.length
    ? state.currentGroups
    : (state.groupSets.length ? state.groupSets[state.groupSets.length - 1].groups : []);

  if (groups.length < 2) { toast('請先到「班級管理 → 隨機分組」分出至少兩組'); return; }
  if (state.territoryQuestions.length === 0) { toast('題庫是空的,先新增幾題'); return; }
  if (TerritoryGame.config && !confirm('目前有一局進行中,重新開始會清空現有戰況。確定嗎?')) return;

  const sizeId = document.getElementById('tgSize').value;
  const size = MAP_SIZES.find(s => s.id === sizeId) || MAP_SIZES[1];
  const config = Territory.createConfig(groups, {
    shape: document.getElementById('tgShape').value,
    radius: size.radius,
    seed: Date.now() % 2147483647,
    threshold: parseInt(document.getElementById('tgThreshold').value) || 5,
    battleSeconds: parseInt(document.getElementById('tgBattle').value) || 90,
    stageMode: document.getElementById('tgStageMode').value,
    stageSeconds: parseInt(document.getElementById('tgStageSeconds').value) || 300
  });

  try {
    await publishTerritoryQuestions();
    await Cloud.clearTerritoryEvents(state.classId);
    await Cloud.saveTerritoryConfig(state.classId, config);  // config 本身不含 snapshot,等於重置
    toast(`✦ 領地戰開始!${MAP_SHAPES[config.shape].name} ${Territory.cellsOf(config).length} 格,${groups.length} 組`);
  } catch (e) {
    console.error(e);
    toast('開局失敗:' + e.message);
  }
}

async function endTerritoryGame() {
  if (!TerritoryGame.config) return;
  if (!confirm('確定結束這一局?')) return;
  await Cloud.saveTerritoryConfig(state.classId,
    { ...TerritoryGame.config, status: 'ended', endedAt: Date.now() });
  toast('領地戰已結束');
}

/* 手動模式下,老師按一次往中心多開一圈 */
async function openNextRing() {
  const c = TerritoryGame.config;
  if (!c) return;
  const depth = Math.min(c.maxDepth + 1, (c.openDepth || 1) + 1);
  await Cloud.saveTerritoryConfig(state.classId, { ...c, openDepth: depth });
  toast(`已開放到基地外第 ${depth} 圈`);
}

/* ============================================
   監聽與重播
   ────────────────────────────────────────────
   老師端與學生端跑的是同一份重播,所以看到的地圖必然一致。
============================================ */

const TerritoryGame = {
  unsubConfig: null,
  unsubEvents: null,
  ticker: null,
  config: null,
  events: [],
  map: {},
  log: [],
  onUpdate: null,      // 學生端掛自己的重繪

  // classId 要能外傳:學生端不會設定 state.classId(那是老師端載入班級才有的),
  // 所以不能沿用 isCloudMode(),否則學生永遠收不到戰況、看不到領地戰分頁。
  start(onUpdate, classId) {
    this.stop();
    const cid = classId || state.classId;
    if (!Cloud.ready || !Cloud.uid || !cid) return;
    this.onUpdate = onUpdate || null;

    this.unsubConfig = Cloud.watchTerritoryConfig(cid, c => {
      this.config = c;
      this.rebuild();
    });
    this.unsubEvents = Cloud.watchTerritoryEvents(cid, list => {
      this.events = list;
      this.rebuild();
    });

    // 戰役到期與階段開放都是「時間到了才發生」,沒有新事件也要重算
    this.ticker = setInterval(() => this.rebuild(), 1000);
  },

  stop() {
    if (this.unsubConfig) { this.unsubConfig(); this.unsubConfig = null; }
    if (this.unsubEvents) { this.unsubEvents(); this.unsubEvents = null; }
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null; }
    this.config = null;
    this.events = [];
    this.map = {};
  },

  rebuild() {
    if (!this.config) { this.map = {}; return; }
    const r = Territory.replay(this.config, this.events);
    this.map = r.map;
    this.log = r.log;
    if (this.onUpdate) this.onUpdate();
    else renderTerritoryLive();
  },

  myTargets(groupIdx) {
    return Territory.targetsFor(this.config, this.map, groupIdx);
  }
};

/* 只更新地圖與戰況,不重繪整個頁面 —— 老師正在打字時不會被打斷 */
function renderTerritoryLive() {
  const board = document.getElementById('territoryBoard');
  if (!board || !board.offsetParent) return;

  // 上千格的地圖每秒重繪很貴。狀態沒變就不動。
  const c = TerritoryGame.config;
  const sig = c ? Territory.signature(c, TerritoryGame.map) : 'none';
  if (sig === _lastMapSig) return;
  _lastMapSig = sig;

  renderTerritoryBoard();
  renderTerritoryFeed();
}

function renderTerritoryBoard() {
  const el = document.getElementById('territoryBoard');
  if (!el) return;

  if (!isCloudMode()) {
    el.innerHTML = '<div class="empty-state">需要登入雲端才能進行領地戰</div>';
    return;
  }
  const c = TerritoryGame.config;
  if (!c) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⬡</div><div>尚未開局。設定好上方選項後按「開始新的一局」</div></div>';
    return;
  }

  const nextAt = Territory.nextStageAt(c);
  const depth = Territory.openDepthAt(c, Date.now());

  el.innerHTML = `
    <div class="territory-status">
      <span class="territory-badge ${c.status}">${c.status === 'running' ? '進行中' : '已結束'}</span>
      <span>${MAP_SHAPES[c.shape] ? MAP_SHAPES[c.shape].name : ''} ·
            ${Object.keys(TerritoryGame.map).length} 格 · 門檻 ${c.threshold} 分 ·
            爭奪 ${c.battleSeconds} 秒</span>
      <span class="territory-stage">
        基地外 ${depth}/${c.maxDepth} 圈${
          nextAt ? ` · 下一圈 ${formatCountdown(nextAt - Date.now())}` : ' · 已全部開放'}
      </span>
      <div style="flex:1"></div>
      ${c.stageMode === 'manual' && depth <= c.maxDepth
        ? '<button class="btn btn-accent btn-small" onclick="openNextRing()">往外開一圈</button>' : ''}
      ${c.status === 'running' && !TerritoryEdit.active
        ? '<button class="btn btn-ghost btn-small" onclick="TerritoryEdit.enter()">手動開放/封鎖</button>' : ''}
      ${TerritoryGame.events.length >= COMPACT_SUGGEST_AT
        ? `<button class="btn btn-accent btn-small" onclick="compactTerritory()"
             title="作答紀錄已累積 ${TerritoryGame.events.length} 筆,壓縮可加快所有人的載入">
             壓縮戰況(${TerritoryGame.events.length})</button>`
        : ''}
      ${c.status === 'running'
        ? '<button class="btn btn-ghost btn-small" onclick="endTerritoryGame()">結束這一局</button>' : ''}
    </div>
    ${renderStandings(c, TerritoryGame.map)}
    ${renderHexMap(c, TerritoryGame.map, {
        zoom: _territoryZoom,
        editMode: TerritoryEdit.active,
        selected: TerritoryEdit.selected
      })}`;
}

function renderTerritoryFeed() {
  const el = document.getElementById('territoryFeed');
  if (!el) return;

  const log = [...TerritoryGame.log].reverse().slice(0, 20);
  if (log.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:20px;">還沒有任何地塊易主</div>';
    return;
  }

  el.innerHTML = log.map(e => e.draw
    ? `<div class="feed-row void"><span class="feed-msg">${e.hexKey} 平手,無人佔領</span></div>`
    : `<div class="feed-row correct">
         <span class="feed-name" style="color:${GROUP_COLORS[e.to % GROUP_COLORS.length]}">
           第 ${e.to + 1} 組</span>
         <span class="feed-msg">以 ${e.points} 分拿下 ${e.hexKey}${
           e.from !== null ? `(原屬第 ${e.from + 1} 組)` : ''}</span>
       </div>`).join('');
}

function renderTerritoryView() {
  fillTerritoryOptions();
  const activeSubtab = document.querySelector('#territoryView .sub-tab.active');
  const name = activeSubtab ? activeSubtab.dataset.subtab : 'tgBoard';
  if (name === 'tgBoard') { renderTerritoryBoard(); renderTerritoryFeed(); }
  if (name === 'tgQuestions') renderTerritoryQuestions();
}

/* 手動開放模式下,倒數秒數的欄位沒有意義 */
function toggleStageSeconds() {
  const auto = document.getElementById('tgStageMode').value === 'auto';
  document.getElementById('tgStageSeconds').style.display = auto ? '' : 'none';
  document.getElementById('tgStageUnit').style.display = auto ? '' : 'none';
}

/* 把形狀與規模的選項填進下拉選單,並顯示這一組合有幾格 */
function fillTerritoryOptions() {
  const shapeSel = document.getElementById('tgShape');
  const sizeSel = document.getElementById('tgSize');
  if (!shapeSel || shapeSel.options.length > 0) return;

  Object.entries(MAP_SHAPES)
    .filter(([k]) => !k.startsWith('_'))
    .forEach(([id, sh]) => {
      shapeSel.insertAdjacentHTML('beforeend',
        `<option value="${id}">${sh.name}</option>`);
    });

  MAP_SIZES.forEach(sz => {
    sizeSel.insertAdjacentHTML('beforeend',
      `<option value="${sz.id}" ${sz.id === 'M' ? 'selected' : ''}>${sz.label} · ${sz.note}</option>`);
  });

  describeShape();
}

function describeShape() {
  const el = document.getElementById('tgShapeDesc');
  if (!el) return;
  const shape = MAP_SHAPES[document.getElementById('tgShape').value];
  const size = MAP_SIZES.find(s => s.id === document.getElementById('tgSize').value);
  if (!shape || !size) return;

  // 不規則地圖的格子數會因種子而異,這裡取一個樣本讓老師有概念
  const count = shape.build(size.radius, 20260810).length;
  el.innerHTML = `
    <strong>${shape.name}</strong> · ${shape.desc}<br>
    這個組合約 <strong>${count}</strong> 格,預估可玩 <strong>${size.note}</strong>。`;
}

/* ============================================
   老師手動編輯開放區域
   ────────────────────────────────────────────
   進入編輯模式後,點地圖上的格子加入選取,再一次套用。
   個別指定會蓋過階段開放 —— 可以提早開放某片區域當獎勵,
   也可以把某些格子封起來當禁區或障礙。
============================================ */

const TerritoryEdit = {
  active: false,
  selected: new Set(),

  enter() {
    if (!TerritoryGame.config) { toast('尚未開局'); return; }
    this.active = true;
    this.selected.clear();
    _lastMapSig = null;
    renderTerritoryBoard();
    toast('點地圖上的格子選取,可連續點多格');
  },

  exit() {
    this.active = false;
    this.selected.clear();
    _lastMapSig = null;
    renderTerritoryBoard();
  },

  clear() {
    this.selected.clear();
    _lastMapSig = null;
    renderTerritoryBoard();
  },

  toggle(hexKey) {
    if (this.selected.has(hexKey)) this.selected.delete(hexKey);
    else this.selected.add(hexKey);
    _lastMapSig = null;
    renderTerritoryBoard();
  }
};

function territoryPick(hexKey) {
  TerritoryEdit.toggle(hexKey);
}

/* value: true = 強制開放 / false = 強制封鎖 / null = 交還給階段開放 */
async function territoryApplyPick(value) {
  const c = TerritoryGame.config;
  if (!c) return;
  if (TerritoryEdit.selected.size === 0) { toast('請先選取格子'); return; }

  const overrides = { ...(c.overrides || {}) };
  TerritoryEdit.selected.forEach(k => {
    if (value === null) delete overrides[k];
    else overrides[k] = value;
  });

  const n = TerritoryEdit.selected.size;
  TerritoryEdit.selected.clear();

  try {
    await Cloud.saveTerritoryConfig(state.classId, { ...c, overrides });
    toast(value === null ? `${n} 格恢復自動開放`
        : value ? `已開放 ${n} 格` : `已封鎖 ${n} 格`);
  } catch (e) {
    console.error(e);
    toast('儲存失敗:' + e.message);
  }
}

/* ============================================
   壓縮戰況
   ────────────────────────────────────────────
   作答事件是這一局的完整歷史,不壓縮的話會一路累積:
   一學期下來可能上萬筆,而每位學生每次開啟頁面都要把它們全部
   下載回來重播。壓縮的做法是把當下的戰況存成一份快照放進設定,
   再刪掉已經反映在快照裡的事件 —— 地圖不變,重播成本歸零。

   代價:正在交戰中的格子會從頭開始,所以壓縮前會先提醒老師。
============================================ */

const COMPACT_SUGGEST_AT = 600;   // 超過這個事件數就提示老師壓縮

async function compactTerritory() {
  const c = TerritoryGame.config;
  if (!c) return;

  const inBattle = Object.values(TerritoryGame.map).filter(x => x.battle).length;
  const n = TerritoryGame.events.length;

  if (!confirm(
    `把目前戰況壓縮成快照,並清掉 ${n} 筆作答紀錄?\n\n` +
    `地圖不會改變,之後載入會快很多。\n` +
    `但「誰答過哪一題」是記在作答紀錄裡的,清掉之後舊題目會重新開放作答。\n` +
    `建議壓縮前先換一批新題目。\n` +
    (inBattle > 0
      ? `\n注意:目前有 ${inBattle} 格正在交戰,壓縮後這些爭奪會歸零重來。`
      : '\n目前沒有正在交戰的格子,是壓縮的好時機。')
  )) return;

  try {
    toast('壓縮中…');
    await Cloud.saveTerritoryConfig(state.classId, {
      ...c,
      snapshot: Territory.snapshotOf(TerritoryGame.map),
      compactedAt: Date.now()
    });
    await Cloud.clearTerritoryEvents(state.classId);
    toast(`✦ 已壓縮,清掉 ${n} 筆紀錄`);
  } catch (e) {
    console.error(e);
    toast('壓縮失敗:' + e.message);
  }
}
