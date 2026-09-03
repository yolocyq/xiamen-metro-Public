/* ============================================================================
 * 厦门地铁 · 实时闸机客流接入 & 大客流预警（前端）
 * ----------------------------------------------------------------------------
 * 设计要点：
 *   1. 页面只保留【一个连接接口】：填写闸机网关地址（+ 可选鉴权 Token）后点
 *      「连接接口」，即实时拉取【全站各站】的闸机客流。未部署真实网关时可用
 *      「使用内置模拟演示」直接查看效果。
 *   2. 鉴权 Token：对接真实闸机 AFC 网关时，网关若启用鉴权，会把 Token 作为
 *      `X-AFC-Token` 请求头带上，用于校验来源合法性（内置模拟演示不需要 Token）。
 *   3. 底部「植入大客流预警标准」：粘贴公司《大客流预警标准》的 JSON（全网通用
 *      阈值 + 各站专属阈值 + 规定正文），即可让本页据实时客流判定各站是否达
 *      到大客流预警。未植入时使用示例占位阈值。
 *   4. 预警阈值与规则前端/网关共用同一套；网关侧亦做服务端预警与推送。
 * ========================================================================== */
(function () {
  'use strict';

  /* ----------------------------- 基础工具 ----------------------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function nf(n) { n = Math.round(n || 0); return n.toLocaleString('en-US'); }
  function $(id) { return document.getElementById(id); }
  // 自包含：避免依赖宿主页面是否定义了这两个工具
  function mulberry32(seed) { var a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hashStr(s) { var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // 时段常量（与 gate-gateway 对齐：全天 96 个 15 分钟时段）
  var SLOT_MIN = 15, SPH = 60 / SLOT_MIN, TOTAL_SLOTS = 24 * SPH;
  var SERVICE_START = 5, SERVICE_END = 24;   // 服务时段（小时），用于展示元数据
  function slotStart(i) { return pad2(Math.floor(i / SPH)) + ':' + pad2((i % SPH) * SLOT_MIN); }
  function slotEnd(i) { var e = i * SLOT_MIN + SLOT_MIN; return pad2(Math.floor(e / 60) % 24) + ':' + pad2(e % 60); }
  function slotIdxNow() { var d = new Date(); return d.getHours() * SPH + Math.floor(d.getMinutes() / SLOT_MIN); }
  function slotProgress() { var d = new Date(); return (d % (SLOT_MIN * 60000)) / (SLOT_MIN * 60000); }

  // 站点属性解析：优先用宿主页面(index.html)的 getStationType/getStationScale，
  // 若以独立文件运行则自包含降级，避免 ReferenceError。
  var stationType = (typeof getStationType === 'function') ? getStationType
    : function (stn) { return ((typeof stationInfo !== 'undefined' && stationInfo && stationInfo[stn]) ? stationInfo[stn].type : undefined) || '通勤'; };
  var stationScale = (typeof getStationScale === 'function') ? getStationScale
    : function (stn) { return ((typeof STATION_SCALE !== 'undefined' && STATION_SCALE) ? (STATION_SCALE[stn] || 1.0) : 1.0); };
  // 站点编码：index.html 未暴露 stationCode，自包含生成一个稳定编码；
  // 若宿主 stationInfo[stn].code 存在则优先使用。
  function stationCode(stn) {
    if (typeof stationInfo !== 'undefined' && stationInfo && stationInfo[stn] && stationInfo[stn].code) return stationInfo[stn].code;
    var h = 0; for (var k = 0; k < stn.length; k++) h = (Math.imul(h, 31) + stn.charCodeAt(k)) >>> 0;
    return 'XM' + String(h % 100000).padStart(5, '0');
  }

  var LEVELS = {
    red: { n: '红色', rank: 4, color: '#d32f2f', bg: '#fdecea', bd: '#f5c6c6' },
    orange: { n: '橙色', rank: 3, color: '#e65100', bg: '#fff3e0', bd: '#ffcc80' },
    yellow: { n: '黄色', rank: 2, color: '#f9a825', bg: '#fffde7', bd: '#ffe082' },
    blue: { n: '蓝色', rank: 1, color: '#1565c0', bg: '#e3f2fd', bd: '#90caf9' },
    none: { n: '正常', rank: 0, color: '#2e7d32', bg: '#e8f5e9', bd: '#a5d6a7' }
  };
  function levelMeta(l) { return LEVELS[l] || LEVELS.none; }

  /* 各等级处置动作（占位，待按公司规定校准） */
  var ACTIONS = {
    red: ['立即启动车站大客流应急预案，车站进入Ⅰ级响应', '关闭部分进站闸机，实施限流、分批放行', '出入口设置导流围栏与蛇形队列，控制进站速度', '报OCC加开备用列车、延长停站时分', '通知辖区公安 / 交警到场协同管控', '暂停站内商业活动，清空站厅滞留人群'],
    orange: ['启动车站大客流处置预案，Ⅱ级响应', '增派站务人员至闸机、扶梯、站台等关键点位', '开启全部售检票设备，增加人工引导与预制票', '加强广播引导与 PIS 信息发布', '向 OCC 报告，做好加开列车准备'],
    yellow: ['加强客流监测，值班站长到现场值守', '增加闸机引导人员，及时处置设备故障', '提高视频巡视频次，重点关注站台与换乘通道密度', '做好限流准备，应急物资与人员待命'],
    blue: ['保持常规监测，关注后续时段客流变化趋势', '复核闸机数据采集链路，排除计数中断风险']
  };

  /* ----------------------------- 默认阈值 ----------------------------- */
  // ⚠️ 全部为占位默认值。拿到公司大客流预警标准文件后，在页面底部「植入标准」即可覆盖。
  var DEFAULT_THRESHOLDS = {
    metric: 'in',                 // 'in' = 进站量；'total' = 进出站合计
    slot15: { blue: 180, yellow: 260, orange: 340, red: 420 },   // 15分钟时段
    hour: { blue: 600, yellow: 900, orange: 1200, red: 1500 },   // 1 小时累计
    peak: { blue: 900, yellow: 1300, orange: 1800, red: 2200 },  // 高峰小时
    day: { blue: 20000, yellow: 30000, orange: 45000, red: 60000 }, // 全天累计
    surge: { blue: 1.3, yellow: 1.6, orange: 2.0, red: 2.5 },    // 环比前4时段均值倍数
    peakHours: [7, 8, 9, 17, 18, 19],
    enable: { slot15: true, hour: true, peak: true, day: true, surge: true }
  };

  function deepMerge(base, over) {
    var out = {};
    for (var k in base) {
      if (!Object.prototype.hasOwnProperty.call(base, k)) continue;
      if (over && Object.prototype.hasOwnProperty.call(over, k)) {
        if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = deepMerge(base[k], over[k]);
        else out[k] = over[k];
      } else out[k] = Array.isArray(base[k]) ? base[k].slice() : (typeof base[k] === 'object' ? deepMerge(base[k], {}) : base[k]);
    }
    return out;
  }

  /* ------------------- 植入的大客流标准（持久化） ------------------- */
  var LS_STD = 'xmAfc.standards.v1';
  var LS_CFG = 'xmAfc.cfg.v1';
  function loadInjected() { try { return JSON.parse(localStorage.getItem(LS_STD) || 'null'); } catch (e) { return null; } }
  function saveInjected(o) { try { localStorage.setItem(LS_STD, JSON.stringify(o)); } catch (e) { } }
  var INJECTED = loadInjected();

  var STD_TEMPLATE = [
    '{',
    '  "regulation": "（在此粘贴公司《大客流预警标准》的规定正文，例如：当车站 15 分钟内进站量达到 X 人时启动对应等级响应……）",',
    '  "global": {',
    '    "metric": "in",',
    '    "slot15": { "blue": 180, "yellow": 260, "orange": 340, "red": 420 },',
    '    "hour":   { "blue": 600, "yellow": 900, "orange": 1200, "red": 1500 },',
    '    "peak":   { "blue": 900, "yellow": 1300, "orange": 1800, "red": 2200 },',
    '    "day":    { "blue": 20000, "yellow": 30000, "orange": 45000, "red": 60000 },',
    '    "surge":  { "blue": 1.3, "yellow": 1.6, "orange": 2.0, "red": 2.5 },',
    '    "peakHours": [7, 8, 9, 17, 18, 19]',
    '  },',
    '  "stations": {',
    '    "吕厝": { "slot15": { "blue": 300, "yellow": 450, "orange": 600, "red": 800 } }',
    '  }',
    '}'
  ].join('\n');

  /* ----------------------------- 连接配置 ----------------------------- */
  var CFG = { endpoint: 'http://127.0.0.1:8788', token: '', pollMs: 3000, mode: 'simulator', selected: null };
  try { var _c = JSON.parse(localStorage.getItem(LS_CFG) || 'null'); if (_c) CFG = Object.assign(CFG, _c); } catch (e) {}
  var ALL_STATIONS = (typeof allStations !== 'undefined' && allStations) ? allStations : (typeof stationList === 'function' ? stationList() : []);
  if (!CFG.selected || ALL_STATIONS.indexOf(CFG.selected) < 0) {
    CFG.selected = ALL_STATIONS.indexOf('吕厝') >= 0 ? '吕厝' : (ALL_STATIONS[0] || null);
  }
  function saveCfg() { try { localStorage.setItem(LS_CFG, JSON.stringify(CFG)); } catch (e) { } }

  /* ============================ 预警引擎 ============================ */
  var AlertEngine = {
    hit: function (th, v) {
      if (!(v > 0)) return null;
      if (v >= th.red) return { level: 'red', th: th.red };
      if (v >= th.orange) return { level: 'orange', th: th.orange };
      if (v >= th.yellow) return { level: 'yellow', th: th.yellow };
      if (v >= th.blue) return { level: 'blue', th: th.blue };
      return null;
    },
    mk: function (snap, rule, dim, window_, value, threshold, level, extra) {
      var ratio = threshold > 0 ? (value / threshold) : 0;
      var unit = rule === 'surge' ? '倍' : '人次';
      var msg = (snap.station || '?') + '站 ' + window_ + ' ' + dim + ' ' + (rule === 'surge' ? value.toFixed(2) : nf(value)) + unit +
        '，达到' + levelMeta(level).n + '阈值 ' + threshold + unit + '（' + Math.round(ratio * 100) + '%）';
      return {
        id: [(snap.date || ''), rule, window_, snap.station || ''].join('|'),
        station: snap.station, level: level, rule: rule, dimension: dim, window: window_,
        value: value, threshold: threshold, ratio: ratio, message: msg,
        actions: ACTIONS[level] || [], ts: snap.ts, ack: false, extra: extra || ''
      };
    },
    evaluate: function (snap, th) {
      var out = [];
      if (!snap) return out;
      var pick = function (o) { return th.metric === 'total' ? o.total : o.in; };
      var lab = th.metric === 'total' ? '进出站合计' : '进站量';
      var nowHour = snap.currentHour ? snap.currentHour.hour : new Date(snap.ts || Date.now()).getHours();

      if (th.enable.slot15 && snap.currentSlot) {
        var v = pick(snap.currentSlot), r = this.hit(th.slot15, v);
        if (r) out.push(this.mk(snap, 'slot15', lab, snap.currentSlot.start + '-' + snap.currentSlot.end, v, r.th, r.level));
      }
      if (th.enable.hour && snap.currentHour) {
        var v2 = pick(snap.currentHour), r2 = this.hit(th.hour, v2);
        if (r2) out.push(this.mk(snap, 'hour', lab, pad2(snap.currentHour.hour) + ':00-' + pad2(snap.currentHour.hour) + ':59', v2, r2.th, r2.level));
      }
      if (th.enable.peak && snap.currentHour && th.peakHours.indexOf(snap.currentHour.hour) >= 0) {
        var v3 = pick(snap.currentHour), r3 = this.hit(th.peak, v3);
        if (r3) out.push(this.mk(snap, 'peak', lab + '·高峰', pad2(snap.currentHour.hour) + ':00-' + pad2(snap.currentHour.hour) + ':59', v3, r3.th, r3.level));
      }
      if (th.enable.day && snap.dayTotal) {
        var v4 = pick(snap.dayTotal), r4 = this.hit(th.day, v4);
        if (r4) out.push(this.mk(snap, 'day', lab + '·全天', (snap.date || '') + ' 累计', v4, r4.th, r4.level));
      }
      if (th.enable.surge && snap.currentSlot && snap.slots && typeof snap.currentSlotIndex === 'number') {
        var ci = snap.currentSlotIndex, sum = 0, cnt = 0;
        for (var i = Math.max(0, ci - 4); i < ci; i++) {
          var s = snap.slots[i]; if (!s) continue;
          sum += pick(s); cnt++;
        }
        var avg = cnt ? sum / cnt : 0;
        if (avg >= 10) {
          var mult = pick(snap.currentSlot) / avg;
          var r5 = this.hit(th.surge, mult);
          if (r5) out.push(this.mk(snap, 'surge', lab + '·环比', snap.currentSlot.start + '-' + snap.currentSlot.end, mult, r5.th, r5.level, '前' + cnt + '时段均值 ' + nf(avg)));
        }
      }
      out.sort(function (a, b) { return levelMeta(b.level).rank - levelMeta(a.level).rank; });
      return out;
    },
    stationLevel: function (alerts) {
      var best = 'none';
      for (var i = 0; i < alerts.length; i++) {
        if (levelMeta(alerts[i].level).rank > levelMeta(best).rank) best = alerts[i].level;
      }
      return best;
    }
  };

  /* ============================ 模拟器 ============================ */
  /* 用站点自身的预测曲线作为形状，叠加噪声与突发，生成与真实闸机同构的数据流。
     仅用于"未接真实闸机"时的演示 / 联调。 */
  function Simulator(station) {
    this.station = station;
    this.reset();
  }
  Simulator.prototype.curve = function () {
    var out = new Array(24).fill(0);
    try {
      var date = (typeof resolveDate === 'function') ? resolveDate(todayStr()) : todayStr();
      var r = predictStation(this.station, date);
      if (r && r.predicted && r.predicted.length === 24) return r.predicted.slice();
    } catch (e) { /* 日期越界等异常 → 退回基线曲线 */ }
    var prof = (typeof BASELINE_PROFILES !== 'undefined' && BASELINE_PROFILES[stationType(this.station)]) || null;
    var scale = stationScale(this.station) * ((typeof GLOBAL_BASELINE_SCALE !== 'undefined') ? GLOBAL_BASELINE_SCALE : 2.65);
    for (var h = 0; h < 24; h++) out[h] = (prof ? prof[h] : 50) * scale;
    return out;
  };
  Simulator.prototype.reset = function () {
    this.date = todayStr();
    this.hourly = this.curve();
    this.rnd = mulberry32(hashStr(this.station + '|' + this.date));
    this.inS = new Array(TOTAL_SLOTS).fill(0);
    this.outS = new Array(TOTAL_SLOTS).fill(0);
    this.curIdx = slotIdxNow();
    this.surgeLeft = 0; this.surgeFactor = 1;
    this.gateTotal = Math.max(4, Math.min(24, Math.round(stationScale(this.station) * 5)));
    this.gates = [];
    for (var g = 0; g < this.gateTotal; g++) {
      this.gates.push({
        id: stationCode(this.station) + '-' + (g % 2 === 0 ? 'A' : 'B') + pad2(Math.floor(g / 2) + 1),
        status: (this.rnd() < 0.06) ? 'fault' : 'online',
        w: 0.6 + this.rnd() * 0.8
      });
    }
    this.backfill();
  };
  Simulator.prototype.expected = function (idx) {
    var h = Math.floor(idx / SPH);
    return Math.max(0, (this.hourly[h] || 0) / SPH);
  };
  Simulator.prototype.inShare = function (idx) {
    var h = Math.floor(idx / SPH);
    if (h >= 6 && h <= 9) return 0.68;
    if (h >= 17 && h <= 20) return 0.34;
    if (h >= 10 && h <= 16) return 0.5;
    return 0.5;
  };
  Simulator.prototype.add = function (idx, amount) {
    var inS = this.inS, outS = this.outS;
    var ish = this.inShare(idx);
    var a = Math.round(amount * ish * (0.9 + this.rnd() * 0.2));
    var b = Math.max(0, Math.round(amount) - a);
    inS[idx] += a; outS[idx] += b;
    var tot = this.gates.length, wsum = 0, i;
    for (i = 0; i < tot; i++) if (this.gates[i].status === 'online') wsum += this.gates[i].w;
    if (wsum > 0) {
      for (i = 0; i < tot; i++) {
        var gt = this.gates[i];
        if (gt.status !== 'online') continue;
        var share = (a + b) * gt.w / wsum;
        gt.in = (gt.in || 0) + Math.round(share * ish);
        gt.out = (gt.out || 0) + Math.round(share * (1 - ish));
        gt.lastTs = Date.now();
      }
    }
  };
  Simulator.prototype.backfill = function () {
    var now = slotIdxNow();
    for (var i = 0; i < now; i++) {
      var e = this.expected(i);
      if (e <= 0) continue;
      var noise = 0.72 + this.rnd() * 0.56;
      this.add(i, e * noise);
    }
    var ec = this.expected(now);
    if (ec > 0) this.add(now, ec * slotProgress() * (0.8 + this.rnd() * 0.4));
    this.curIdx = now;
  };
  Simulator.prototype.tick = function () {
    var now = slotIdxNow();
    if (now < this.curIdx) { this.reset(); return; }
    while (this.curIdx < now) {
      var e = this.expected(this.curIdx);
      var done = (this.inS[this.curIdx] || 0) + (this.outS[this.curIdx] || 0);
      if (e > done) this.add(this.curIdx, (e - done) * (0.5 + this.rnd() * 0.5));
      this.curIdx++;
    }
    if (this.surgeLeft > 0) this.surgeLeft--;
    else if (this.rnd() < 0.012) { this.surgeLeft = 2 + Math.floor(this.rnd() * 5); this.surgeFactor = 1.6 + this.rnd() * 1.6; }
    else this.surgeFactor = 1;
    var ec = this.expected(now) * this.surgeFactor;
    var target = ec * slotProgress();
    var cur = (this.inS[now] || 0) + (this.outS[now] || 0);
    if (target > cur) {
      var add = (target - cur) * (0.55 + this.rnd() * 0.9);
      if (add < 0.2 && this.rnd() < 0.25) add = 1;
      if (add > 0) this.add(now, add);
    }
  };
  Simulator.prototype.injectSurge = function (factor, slotsKeep) {
    this.surgeFactor = factor || 3.0;
    this.surgeLeft = slotsKeep || 4;
    var now = slotIdxNow();
    var e = this.expected(now) * 4;
    if (e > 0) this.add(now, e);
  };
  Simulator.prototype.snapshot = function () {
    var slots = [], i;
    for (i = 0; i < TOTAL_SLOTS; i++) {
      var a = Math.round(this.inS[i] || 0), b = Math.round(this.outS[i] || 0);
      slots.push({ start: slotStart(i), end: slotEnd(i), in: a, out: b, total: a + b });
    }
    var hourly = [];
    for (var h = 0; h < 24; h++) {
      var hi = 0, ho = 0;
      for (i = h * SPH; i < h * SPH + SPH; i++) { hi += slots[i].in; ho += slots[i].out; }
      hourly.push({ hour: h, in: hi, out: ho, total: hi + ho });
    }
    var tIn = 0, tOut = 0;
    for (i = 0; i < TOTAL_SLOTS; i++) { tIn += slots[i].in; tOut += slots[i].out; }
    var nowH = new Date().getHours();
    var ci = slotIdxNow();
    var peak = slots[0];
    for (i = 1; i < TOTAL_SLOTS; i++) if (slots[i].total > peak.total) peak = slots[i];
    var gates = this.gates.map(function (g) {
      return { id: g.id, status: g.status, in: g.in || 0, out: g.out || 0, total: (g.in || 0) + (g.out || 0), lastTs: g.lastTs || 0 };
    });
    var online = gates.filter(function (g) { return g.status === 'online'; }).length;
    return {
      ts: Date.now(), date: this.date, mode: 'sim', station: this.station,
      slotMinutes: SLOT_MIN, serviceStart: SERVICE_START, serviceEnd: SERVICE_END,
      currentSlotIndex: ci, slots: slots, hourly: hourly,
      dayTotal: { in: tIn, out: tOut, total: tIn + tOut },
      currentSlot: slots[ci], currentHour: hourly[nowH], peakSlot: peak,
      gates: gates, gateOnline: online, gateTotal: gates.length,
      predicted: this.hourly.slice(), surgeActive: this.surgeLeft > 0
    };
  };

  /* ============================ 接入层（全站） ============================ */
  var GateLink = {
    state: 'idle',          // idle | connecting | live | sim | down
    err: '',
    lastTs: 0,
    snapAll: [],            // 全站摘要快照（用于网格）
    snapDetail: null,       // 选中站详情快照
    selected: CFG.selected,
    sims: {},
    timer: null,
    onUpdate: null,

    connect: function (mode) {
      this.stop();
      CFG.mode = mode; saveCfg();
      if (mode === 'simulator') {
        this.sims = {};
        var list = ALL_STATIONS;
        for (var i = 0; i < list.length; i++) this.sims[list[i]] = new Simulator(list[i]);
        this.state = 'sim'; this.err = '';
        var self = this;
        this.tickSim();
        this.timer = setInterval(function () { self.tickSim(); }, Math.max(1000, CFG.pollMs));
      } else {
        this.state = 'connecting'; this.err = '';
        var self2 = this;
        this.pullAll();
        this.timer = setInterval(function () { self2.pullAll(); }, Math.max(1000, CFG.pollMs));
      }
      if (this.onUpdate) this.onUpdate();
    },

    tickSim: function () {
      var all = [], self = this;
      for (var name in this.sims) { this.sims[name].tick(); all.push(this.sims[name].snapshot()); }
      this.snapAll = all;
      this.state = 'sim'; this.lastTs = Date.now();
      if (this.selected && this.sims[this.selected]) this.snapDetail = this.sims[this.selected].snapshot();
      if (this.onUpdate) this.onUpdate();
    },

    pullAll: function () {
      var self = this;
      var url = CFG.endpoint.replace(/\/+$/, '') + '/api/afc/summary';
      var opt = { cache: 'no-store' };
      if (CFG.token) opt.headers = { 'X-AFC-Token': CFG.token };
      fetch(url, opt).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          if (!j || !j.ok || !j.data || !j.data.stations) throw new Error('响应格式错误');
          self.snapAll = j.data.stations.map(function (s) {
            return {
              station: s.station, code: s.code, date: todayStr(), ts: Date.now(),
              currentSlot: s.currentSlot || { start: '-', end: '-', in: 0, out: 0, total: 0 },
              currentHour: undefined, dayTotal: s.dayTotal || { in: 0, out: 0, total: 0 },
              slots: undefined, currentSlotIndex: undefined, gates: s.gates
            };
          });
          self.state = 'live'; self.err = ''; self.lastTs = Date.now();
          if (self.selected) self.pullDetail(self.selected);
          if (self.onUpdate) self.onUpdate();
        })
        .catch(function (e) { self.state = 'down'; self.err = String(e.message || e); if (self.onUpdate) self.onUpdate(); });
    },

    pullDetail: function (station) {
      if (CFG.mode === 'simulator') {
        if (this.sims[station]) this.snapDetail = this.sims[station].snapshot();
        if (this.onUpdate) this.onUpdate();
        return;
      }
      var self = this;
      var url = CFG.endpoint.replace(/\/+$/, '') + '/api/afc/realtime?station=' + encodeURIComponent(station);
      var opt = { cache: 'no-store' };
      if (CFG.token) opt.headers = { 'X-AFC-Token': CFG.token };
      fetch(url, opt).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.ok && j.data) { self.snapDetail = j.data; self.lastTs = Date.now(); if (self.onUpdate) self.onUpdate(); }
      }).catch(function () { });
    },

    select: function (station) {
      this.selected = station; CFG.selected = station; saveCfg();
      if (this.state === 'sim' || this.state === 'live') this.pullDetail(station);
      if (this.onUpdate) this.onUpdate();
    },

    stop: function () { if (this.timer) { clearInterval(this.timer); this.timer = null; } },
    disconnect: function () {
      this.stop(); this.state = 'idle'; this.err = ''; this.snapAll = []; this.snapDetail = null;
      if (this.onUpdate) this.onUpdate();
    }
  };

  /* ============================ 渲染层 ============================ */
  function statePill() {
    var map = {
      live: { c: 'st-live', t: '实时数据 · 闸机已接入' },
      sim: { c: 'st-sim', t: '内置模拟演示 · 未接真实闸机' },
      connecting: { c: 'st-idle', t: '连接中…' },
      down: { c: 'st-down', t: '连接失败' },
      idle: { c: 'st-idle', t: '未连接' }
    };
    var s = map[GateLink.state] || map.idle;
    var txt = (GateLink.state === 'down' && GateLink.err) ? ('连接失败 · ' + esc(GateLink.err)) : s.t;
    var ago = GateLink.lastTs ? (' · ' + new Date(GateLink.lastTs).toLocaleTimeString('zh-CN', { hour12: false })) : '';
    return '<span class="status-pill ' + s.c + '"><span class="dot"></span>' + txt + ago + '</span>';
  }

  function resolveStd(station) {
    var t = deepMerge(DEFAULT_THRESHOLDS, null);
    if (INJECTED && INJECTED.global) t = deepMerge(t, INJECTED.global);
    if (INJECTED && INJECTED.stations && INJECTED.stations[station]) t = deepMerge(t, INJECTED.stations[station]);
    return t;
  }
  function snapOf(station) {
    for (var i = 0; i < GateLink.snapAll.length; i++) if (GateLink.snapAll[i].station === station) return GateLink.snapAll[i];
    return null;
  }
  function alertOf(station) {
    var snap = snapOf(station);
    if (!snap) return { level: 'none', alerts: [] };
    var alerts = AlertEngine.evaluate(snap, resolveStd(station));
    return { level: AlertEngine.stationLevel(alerts), alerts: alerts };
  }

  function skeleton() {
    var h = '';
    h += '<div class="card conn-card"><div class="card-title"><span class="icon">🔌</span>闸机实时客流接入</div>';
    h += '<div class="conn-bar">';
    h += '<div class="fld"><label>闸机接口地址</label><input type="text" id="g-endpoint" value="' + esc(CFG.endpoint) + '" placeholder="http://127.0.0.1:8788"></div>';
    h += '<div class="fld"><label>鉴权 Token</label><input type="text" id="g-token" value="' + esc(CFG.token) + '" placeholder="连接真实闸机网关时填写"></div>';
    h += '<button class="btn btn-pri" id="g-connect">▶ 连接接口</button>';
    h += '<button class="btn btn-sec" id="g-sim">▶ 使用内置模拟演示</button>';
    h += '<div class="fld" style="margin-left:auto;"><span id="g-state-pill">' + statePill() + '</span></div>';
    h += '</div>';
    h += '<div class="notice" id="g-conn-note">接入说明：真实闸机 / 车站 AFC 前置机按 <code>POST /api/afc/tap</code> 上报通行记录 → <b>gate-gateway</b> 按 15 分钟时段聚合并预警 → 本页通过 HTTP 轮询 <code>/api/afc/summary</code> 拉取全站实时客流。若尚未部署闸机网关，可点「使用内置模拟演示」直接查看效果。Token 用于对接真实闸机网关的鉴权（详见下方说明）。</div>';
    h += '</div>';

    h += '<div id="gate-summary" class="gate-summary"></div>';

    h += '<div class="card"><div class="card-title"><span class="icon">🚉</span>各站实时闸机客流（点击查看详情）</div><div id="gate-grid" class="gate-grid"></div></div>';

    h += '<div id="gate-detail"></div>';

    h += '<div class="card std-card"><div class="card-title"><span class="icon">📐</span>植入大客流预警标准</div>';
    h += '<div class="notice">连接后，本页依据下方植入的标准对各站实时客流判定大客流预警。未植入时使用示例占位阈值；待你提供公司《大客流预警标准》数值与规定后，粘贴 JSON 即可全局生效。</div>';
    h += '<div class="std-box"><textarea id="g-std-json" spellcheck="false">' + esc(STD_TEMPLATE) + '</textarea>';
    h += '<div class="std-btns"><button class="btn btn-pri" id="g-std-apply">⬆ 植入标准</button><button class="btn btn-sec" id="g-std-reset">↺ 恢复默认</button><button class="btn btn-sec" id="g-std-export">⬇ 导出</button></div>';
    h += '<div id="g-std-status" class="std-status"></div><div id="g-std-reg"></div></div></div>';
    return h;
  }

  function bindConn() {
    $('g-connect').onclick = function () {
      CFG.endpoint = ($('g-endpoint').value || '').trim() || 'http://127.0.0.1:8788';
      CFG.token = ($('g-token').value || '').trim(); saveCfg();
      GateLink.connect('http');
    };
    $('g-sim').onclick = function () {
      CFG.token = ($('g-token').value || '').trim(); saveCfg();
      GateLink.connect('simulator');
    };
    $('g-endpoint').onchange = function () { CFG.endpoint = (this.value || '').trim() || 'http://127.0.0.1:8788'; saveCfg(); };
    $('g-token').onchange = function () { CFG.token = (this.value || '').trim(); saveCfg(); };
  }

  function bindStandards() {
    $('g-std-apply').onclick = function () {
      try {
        var o = JSON.parse($('g-std-json').value);
        INJECTED = o; saveInjected(o);
        var cnt = o.stations ? Object.keys(o.stations).length : 0;
        $('g-std-status').innerHTML = '<span style="color:#2e7d32;">✅ 已植入标准：全网通用阈值' + (cnt ? (' + ' + cnt + ' 个站点专属阈值') : '') + '，各站实时客流已按此标准判定预警。</span>';
        if (GateLink.onUpdate) GateLink.onUpdate();
      } catch (e) { $('g-std-status').innerHTML = '<span style="color:#c62828;">❌ JSON 解析失败：' + esc(e.message) + '</span>'; }
    };
    $('g-std-reset').onclick = function () {
      INJECTED = null; saveInjected(null);
      $('g-std-json').value = STD_TEMPLATE;
      $('g-std-status').innerHTML = '<span style="color:#888;">已恢复默认占位阈值。</span>';
      if (GateLink.onUpdate) GateLink.onUpdate();
    };
    $('g-std-export').onclick = function () {
      var a = document.createElement('a');
      a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent($('g-std-json').value);
      a.download = 'afc-alert-standards.json'; a.click();
    };
  }

  function renderSummary() {
    var el = $('gate-summary'); if (!el) return;
    if (!GateLink.snapAll.length) { el.innerHTML = ''; return; }
    var cnt = { red: 0, orange: 0, yellow: 0, blue: 0, none: 0 };
    for (var i = 0; i < GateLink.snapAll.length; i++) cnt[alertOf(GateLink.snapAll[i].station).level]++;
    el.innerHTML = '<span class="lvl-chip red">🔴 红 ' + cnt.red + '</span>' +
      '<span class="lvl-chip orange">🟠 橙 ' + cnt.orange + '</span>' +
      '<span class="lvl-chip yellow">🟡 黄 ' + cnt.yellow + '</span>' +
      '<span class="lvl-chip blue">🔵 蓝 ' + cnt.blue + '</span>' +
      '<span class="lvl-chip none">⚪ 正常 ' + cnt.none + '</span>' +
      '<span style="margin-left:auto;font-size:12px;color:#888;">共 ' + GateLink.snapAll.length + ' 站</span>';
  }

  function renderGrid() {
    var el = $('gate-grid'); if (!el) return;
    if (!GateLink.snapAll.length) {
      el.innerHTML = '<div style="color:#999;padding:24px;text-align:center;">未连接。请先点上方「连接接口」或「使用内置模拟演示」。</div>';
      return;
    }
    var rows = GateLink.snapAll.slice().sort(function (a, b) {
      var ra = levelMeta(alertOf(a.station).level).rank, rb = levelMeta(alertOf(b.station).level).rank;
      if (rb !== ra) return rb - ra;
      return (b.dayTotal.total || 0) - (a.dayTotal.total || 0);
    });
    var html = '<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr style="background:#f5f5f5;">' +
      '<th style="padding:7px;text-align:left;">车站</th><th style="padding:7px;text-align:center;">预警</th>' +
      '<th style="padding:7px;text-align:right;">当前时段 进/出/计</th><th style="padding:7px;text-align:right;">全天累计 进/出/计</th>' +
      '<th style="padding:7px;text-align:center;">闸机</th><th style="padding:7px;text-align:center;">操作</th></tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var s = rows[i], a = alertOf(s.station).level, lm = levelMeta(a);
      var cs = s.currentSlot || { in: 0, out: 0, total: 0 }, dt = s.dayTotal || { in: 0, out: 0, total: 0 };
      var gates = (s.gates && s.gates.length) ? (function () { var on = 0; for (var k = 0; k < s.gates.length; k++) if (s.gates[k].status === 'online') on++; return on + '/' + s.gates.length; })() : '-';
      html += '<tr class="gate-row" style="border-top:1px solid #eee;cursor:pointer;" onclick="GateLink.select(\'' + esc(s.station) + '\')">' +
        '<td style="padding:6px 8px;"><b>' + esc(s.station) + '</b> <span style="color:#999;">' + esc(s.code || '') + '</span></td>' +
        '<td style="padding:6px 8px;text-align:center;"><span class="lvl-badge" style="background:' + lm.bg + ';color:' + lm.color + ';border:1px solid ' + lm.bd + ';">' + lm.n + '</span></td>' +
        '<td style="padding:6px 8px;text-align:right;">' + nf(cs.in) + ' / ' + nf(cs.out) + ' / <b>' + nf(cs.total) + '</b></td>' +
        '<td style="padding:6px 8px;text-align:right;">' + nf(dt.in) + ' / ' + nf(dt.out) + ' / <b>' + nf(dt.total) + '</b></td>' +
        '<td style="padding:6px 8px;text-align:center;">' + gates + '</td>' +
        '<td style="padding:6px 8px;text-align:center;"><span style="color:#0066cc;">查看 ›</span></td></tr>';
    }
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  function renderDetail() {
    var el = $('gate-detail'); if (!el) return;
    var st = GateLink.selected;
    if (!st) { el.innerHTML = ''; return; }
    var sd = (GateLink.state === 'simulator' && GateLink.sims[st]) ? GateLink.sims[st].snapshot() : GateLink.snapDetail;
    if (!sd) { el.innerHTML = '<div class="card"><div class="card-title">📊 ' + esc(st) + ' 实时详情</div><div style="color:#999;padding:18px;">（点击上方网格中的车站查看详情）</div></div>'; return; }
    var al = AlertEngine.evaluate(sd, resolveStd(st));
    var a = AlertEngine.stationLevel(al), lm = levelMeta(a);
    var th = resolveStd(st);
    var html = '<div class="card"><div class="card-title"><span class="icon">📊</span>' + esc(st) + ' 实时详情' +
      '<span class="lvl-badge" style="margin-left:10px;background:' + lm.bg + ';color:' + lm.color + ';border:1px solid ' + lm.bd + ';">' + lm.n + '预警</span></div>';

    var cs = sd.currentSlot || { start: '-', end: '-', in: 0, out: 0, total: 0 };
    var dt = sd.dayTotal || { in: 0, out: 0, total: 0 };
    var ch = sd.currentHour || { hour: new Date().getHours(), total: 0 };
    html += '<div class="kv"><div class="kv-i"><div class="kv-l">当前时段 ' + esc(cs.start) + '-' + esc(cs.end) + '</div><div class="kv-v">进 ' + nf(cs.in) + ' / 出 ' + nf(cs.out) + ' / 计 ' + nf(cs.total) + '</div></div>' +
      '<div class="kv-i"><div class="kv-l">当前小时 ' + pad2(ch.hour) + ':00</div><div class="kv-v">' + nf(ch.total) + ' 人次</div></div>' +
      '<div class="kv-i"><div class="kv-l">全天累计</div><div class="kv-v">进 ' + nf(dt.in) + ' / 出 ' + nf(dt.out) + ' / 计 ' + nf(dt.total) + '</div></div>' +
      '<div class="kv-i"><div class="kv-l">判定口径</div><div class="kv-v">' + (th.metric === 'total' ? '进出站合计' : '进站量') + '</div></div></div>';

    if (al.length) {
      html += '<div class="alert-box" style="border-left:4px solid ' + lm.color + ';background:' + lm.bg + ';">' +
        '<div style="font-weight:700;color:' + lm.color + ';margin-bottom:6px;">⚠ 已达' + lm.n + '大客流预警（' + al.length + ' 条规则命中）</div>';
      for (var i = 0; i < al.length; i++) {
        html += '<div style="font-size:12px;margin:3px 0;">• ' + esc(al[i].message) + '</div>';
        if (al[i].actions && al[i].actions.length) html += '<div style="font-size:11px;color:#555;margin:1px 0 4px 14px;">↳ ' + esc(al[i].actions.slice(0, 3).join('；')) + '</div>';
      }
      html += '</div>';
    } else {
      html += '<div class="alert-box" style="border-left:4px solid #2e7d32;background:#e8f5e9;color:#2e7d32;font-size:13px;">✅ 当前未达任何大客流预警阈值。</div>';
    }

    var hr = sd.hourly || [];
    if (hr.length) {
      var maxv = 1; for (var h = 0; h < hr.length; h++) maxv = Math.max(maxv, hr[h].total);
      html += '<div style="margin-top:12px;"><div style="font-size:12px;color:#666;margin-bottom:6px;">24 小时分时客流（进站 / 出站）</div><div class="bars">';
      for (var h2 = 0; h2 < hr.length; h2++) {
        var hi = maxv ? (hr[h2].in / maxv * 100) : 0, ho = maxv ? (hr[h2].out / maxv * 100) : 0;
        html += '<div class="bar-col" title="' + pad2(hr[h2].hour) + ':00 进' + hr[h2].in + '/出' + hr[h2].out + '">' +
          '<div class="bar in" style="height:' + hi + '%"></div><div class="bar out" style="height:' + ho + '%"></div>' +
          (h2 % 3 === 0 ? '<div class="bar-x">' + pad2(hr[h2].hour) + '</div>' : '') + '</div>';
      }
      html += '</div></div>';
    }

    var slots = sd.slots || [];
    if (slots.length) {
      var ci = (typeof sd.currentSlotIndex === 'number') ? sd.currentSlotIndex : slots.length - 1;
      var from = Math.max(0, ci - 11);
      html += '<div style="margin-top:12px;"><div style="font-size:12px;color:#666;margin-bottom:6px;">最近时段明细（15 分钟）</div><div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr style="background:#f5f5f5;"><th style="padding:4px;text-align:left;">时段</th><th style="padding:4px;text-align:right;">进</th><th style="padding:4px;text-align:right;">出</th><th style="padding:4px;text-align:right;">计</th></tr></thead><tbody>';
      for (var k = from; k <= ci; k++) {
        var sl = slots[k]; if (!sl) continue;
        var cur = (k === ci) ? ' style="background:#eef6ff;font-weight:700;"' : '';
        html += '<tr' + cur + ' style="border-top:1px solid #eee;"><td style="padding:3px 6px;">' + esc(sl.start) + '-' + esc(sl.end) + '</td><td style="padding:3px 6px;text-align:right;">' + nf(sl.in) + '</td><td style="padding:3px 6px;text-align:right;">' + nf(sl.out) + '</td><td style="padding:3px 6px;text-align:right;">' + nf(sl.total) + '</td></tr>';
      }
      html += '</tbody></table></div></div>';
    }

    var gates = sd.gates || [];
    if (gates.length) {
      var on = 0; for (var g = 0; g < gates.length; g++) if (gates[g].status === 'online') on++;
      html += '<div style="margin-top:12px;font-size:12px;color:#666;">闸机设备：' + on + ' / ' + gates.length + ' 在线。' +
        (on < gates.length ? ' <span style="color:#e65100;">' + (gates.length - on) + ' 台离线，请核查采集链路。</span>' : '') + '</div>';
    }

    html += '</div>';
    el.innerHTML = html;
  }

  function renderStandardsStatus() {
    var reg = $('g-std-reg'); if (!reg) return;
    if (INJECTED && INJECTED.regulation) {
      reg.innerHTML = '<div style="margin-top:8px;padding:8px 10px;background:#fff8e1;border:1px solid #ffe082;border-radius:6px;font-size:12px;"><b>📋 公司规定：</b>' + esc(INJECTED.regulation) + '</div>';
    } else {
      reg.innerHTML = '<div style="margin-top:8px;font-size:12px;color:#888;">尚未植入公司规定。当前使用示例占位阈值。</div>';
    }
  }

  function renderAll() {
    if (typeof ACTIVE_TAB !== 'undefined' && ACTIVE_TAB !== 'gate') return;
    var c = $('tab-gate'); if (!c || !c.dataset.built) return;
    var pill = $('g-state-pill'); if (pill) pill.innerHTML = statePill();
    var note = $('g-conn-note');
    if (note && GateLink.state === 'down') note.innerHTML = '⚠️ 连接失败：' + esc(GateLink.err) + '。若尚未部署闸机网关，可点「使用内置模拟演示」查看效果。';
    renderSummary(); renderGrid(); renderDetail(); renderStandardsStatus();
  }

  function loadGate() {
    var c = $('tab-gate'); if (!c) return;
    if (!c.dataset.built) {
      c.innerHTML = skeleton();
      c.dataset.built = '1';
      bindConn(); bindStandards();
      if (INJECTED) $('g-std-json').value = JSON.stringify(INJECTED, null, 2);
    }
    GateLink.selected = GateLink.selected || CFG.selected;
    GateLink.onUpdate = renderAll;
    renderAll();
  }

  window.loadGate = loadGate;
  window.GateLink = GateLink;
  window.Simulator = Simulator;
})();
