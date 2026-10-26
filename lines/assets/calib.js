/* =====================================================================
 * calib.js — 学习层（实际数据导入 → 长期记忆 → 逐次收敛）
 *
 * 与旧版「一次覆盖」的校准不同，这一版是累积学习：
 *
 *   每一次导入的数据都并入一张「站点 × 日期」的实测台账（byDate），
 *   同一天重复导入以最新值为准（不会重复计数），
 *   基准每次都由全量台账重新计算 —— 所以样本越多，基准越稳。
 *
 * 长期记忆：
 *   · 台账、线路基准、周内系数、学习履历全部写入 localStorage
 *   · 关浏览器、重启电脑、隔几个月再打开，都还在
 *   · 支持导出/导入学习档案 JSON，换电脑或换浏览器可迁移
 *
 * 关键一步是「剥离」：用户给的某天客流 = 稳定期基准 × 当日日历系数
 * × 当日尝鲜系数 × 票制系数。要得到可复用的基准，必须把这些暂时性
 * 系数除掉，否则开通初期的尝鲜峰值会被当成常态写进基准。
 * =================================================================== */

var Calib = (function () {

  var KEY = "xmMetroLearn_v2";
  var OLD_KEY = "xmMetroCalib_v1";

  var state = blank();

  function blank() {
    return {
      version: 2,
      stations: {},    /* name -> { byDate:{date:value}, days, daily, rawMean, stripped, firstAt, lastAt } */
      lines: {},       /* lineId -> { daily, knownStations, totalStations, coverage, samples } */
      globalDow: null,
      history: [],     /* [{ at, file, records, stations, days, beforeMape, afterMape }] */
      meta: {},
      updatedAt: null
    };
  }

  /* ---------------- 存取 ---------------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        state = Object.assign(blank(), o || {});
        if (!state.stations) state.stations = {};
        if (!state.lines) state.lines = {};
        if (!Array.isArray(state.history)) state.history = [];
      } else {
        var old = localStorage.getItem(OLD_KEY);
        if (old) migrate(JSON.parse(old));
      }
    } catch (e) { /* 隐私模式等场景下 localStorage 不可用，降级为内存态 */ }
    syncGlobalDow();
  }

  /* 旧版（v1）档案升级：v1 只有日均，没有逐日台账。
   * 升级时把日均当作「1 个样本」迁入，样本权重较低，后续导入会迅速覆盖。 */
  function migrate(o) {
    if (!o || !o.stations) return;
    Object.keys(o.stations).forEach(function (n) {
      var s = o.stations[n];
      state.stations[n] = {
        byDate: {},
        legacyDaily: s.daily,
        legacyDays: s.days || 1,
        days: s.days || 1,
        daily: s.daily,
        rawMean: s.rawMean || s.daily,
        stripped: !!s.stripped,
        firstAt: null,
        lastAt: null,
        migrated: true
      };
    });
    if (o.lines) state.lines = o.lines;
    if (o.globalDow) state.globalDow = o.globalDow;
    state.meta = { migratedFrom: "v1", migratedAt: new Date().toISOString() };
    save();
  }

  function save() {
    state.updatedAt = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  /* 把学到的周内系数写回全局常量，供模型使用 */
  function syncGlobalDow() {
    if (state.globalDow) {
      for (var k in state.globalDow) {
        if (DOW_COEF[k] !== undefined) DOW_COEF[k] = state.globalDow[k];
      }
    }
  }

  var DEFAULT_DOW = null;
  function captureDefaultDow() {
    DEFAULT_DOW = {};
    for (var k in DOW_COEF) DEFAULT_DOW[k] = DOW_COEF[k];
  }

  /* ---------------- 查询接口 ---------------- */
  function getLineCalibration(lineId) { return state.lines[lineId] || null; }
  function getStationCalibration(name) { return state.stations[name] || null; }
  function meta() { return state.meta || {}; }
  function history() { return state.history || []; }
  function isEmpty() {
    return Object.keys(state.stations).length === 0 && Object.keys(state.lines).length === 0;
  }
  function stationCount() { return Object.keys(state.stations).length; }
  function totalDays() {
    var set = {};
    Object.keys(state.stations).forEach(function (n) {
      Object.keys(state.stations[n].byDate || {}).forEach(function (d) { set[n + "|" + d] = 1; });
    });
    return Object.keys(set).length;
  }
  function totalRecords() {
    var t = 0;
    Object.keys(state.stations).forEach(function (n) {
      t += Object.keys(state.stations[n].byDate || {}).length;
    });
    /* 旧档案只有日均、没有逐日记录，用 days 兜底 */
    Object.keys(state.stations).forEach(function (n) {
      if (!Object.keys(state.stations[n].byDate || {}).length) t += state.stations[n].legacyDays || 0;
    });
    return t;
  }

  /* ---------------- 统计工具 ---------------- */
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }

  function mape(pairs) {
    var valid = pairs.filter(function (p) { return p.actual > 0; });
    if (!valid.length) return null;
    var s = valid.reduce(function (a, p) { return a + Math.abs(p.pred - p.actual) / p.actual; }, 0);
    return s / valid.length;
  }
  function mae(pairs) {
    if (!pairs.length) return null;
    return pairs.reduce(function (a, p) { return a + Math.abs(p.pred - p.actual); }, 0) / pairs.length;
  }
  function rmse(pairs) {
    if (!pairs.length) return null;
    return Math.sqrt(pairs.reduce(function (a, p) { return a + Math.pow(p.pred - p.actual, 2); }, 0) / pairs.length);
  }
  function bias(pairs) {
    if (!pairs.length) return null;
    var num = pairs.reduce(function (a, p) { return a + (p.pred - p.actual); }, 0);
    var den = pairs.reduce(function (a, p) { return a + p.actual; }, 0);
    return den ? num / den : null;
  }
  function r2(pairs) {
    if (pairs.length < 2) return null;
    var as = pairs.map(function (p) { return p.actual; });
    var m = mean(as);
    var ssTot = as.reduce(function (a, v) { return a + Math.pow(v - m, 2); }, 0);
    if (!ssTot) return null;
    var ssRes = pairs.reduce(function (a, p) { return a + Math.pow(p.actual - p.pred, 2); }, 0);
    return 1 - ssRes / ssTot;
  }

  /* ---------------- 回测：用当前模型逐条预测 ---------------- */
  /* records: [{station, date, inbound}] */
  function backtest(records, weather) {
    var pairs = [], miss = [], pending = [];
    records.forEach(function (r) {
      var st = STATIONS.filter(function (s) { return s.name === r.station; })[0];
      if (!st) { miss.push(r.station); return; }
      if (st.status !== "open") { pending.push(r.station); return; }
      var p = Model.predictStation(st, r.date, weather || null);
      if (p.closed) return;
      pairs.push({ station: r.station, date: r.date, pred: p.daily, actual: r.inbound });
    });
    return {
      pairs: pairs,
      unmatched: Array.from(new Set(miss)),
      pendingNamed: Array.from(new Set(pending)),
      n: pairs.length,
      mape: mape(pairs), mae: mae(pairs), rmse: rmse(pairs), bias: bias(pairs), r2: r2(pairs)
    };
  }

  /* ---------------- 反算「稳定期基准」 ---------------- */
  /* 把当日日历系数、尝鲜系数、票制系数全部除掉，只留下可复用的基准 */
  function strippedOf(st, byDate) {
    var vals = [];
    Object.keys(byDate).forEach(function (d) {
      var g = Model.calendarFactor(st, d).coef
        * Model.noveltyFactor(st.line, d).value
        * Model.fareFactor().value;
      if (g > 0.01) vals.push(byDate[d] / g);
    });
    return vals.length ? mean(vals) : null;
  }

  /* ---------------- 周内系数（跨站、跨批次累积） ---------------- */
  function dowFromAllStations() {
    var acc = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    Object.keys(state.stations).forEach(function (name) {
      var s = state.stations[name];
      var dates = Object.keys(s.byDate || {});
      if (dates.length < 7) return;                 /* 样本不足一周的站不参与 */
      var vals = dates.map(function (d) { return s.byDate[d]; });
      var m = mean(vals);
      if (!m) return;
      dates.forEach(function (d) {
        var w = Model.dow(d);
        acc[w].push(s.byDate[d] / m);
      });
    });
    var out = {}, any = false;
    for (var k in acc) {
      if (acc[k].length >= 3) { out[k] = +mean(acc[k]).toFixed(3); any = true; }
    }
    return any ? out : null;
  }

  /* ---------------- 主流程：把一批数据并入长期记忆 ---------------- */
  /* 返回 { before, after, merged, added, stationCount, lineResults, dow } */
  function learn(records, weather, fileName) {

    /* ① 学习前先回测，作为「这次导入前模型有多准」的基线 */
    var before = backtest(records, weather);

    /* ② 并入台账：同一天重复导入以最新值为准，天然去重 */
    var added = 0, touchedStations = {};
    records.forEach(function (r) {
      var st = STATIONS.filter(function (s) { return s.name === r.station; })[0];
      if (!st) return;                       /* 站名不匹配，跳过 */
      if (st.status !== "open") return;      /* 未开通站不学，避免把异常值写进记忆 */

      var rec = state.stations[r.station];
      if (!rec) {
        rec = state.stations[r.station] = {
          byDate: {}, days: 0, daily: 0, rawMean: 0, stripped: false,
          firstAt: null, lastAt: null
        };
      }
      if (!rec.byDate) rec.byDate = {};
      var v = Number(r.inbound) || 0;
      if (v <= 0) return;                    /* 0 或负值视为缺失，不写入 */
      if (rec.byDate[r.date] === undefined) added++;
      rec.byDate[r.date] = v;
      touchedStations[r.station] = true;

      var ds = Object.keys(rec.byDate).sort();
      if (ds.length) { rec.firstAt = ds[0]; rec.lastAt = ds[ds.length - 1]; }
    });

    /* ③ 先更新周内系数，再重算站点基准。
     * 顺序很关键：剥离系数（strippedOf）里用到的 DOW_COEF，
     * 必须与后面预测时用到的 DOW_COEF 是同一套，否则同一批数据
     * 反复导入会让基准缓慢漂移（实测每次约 +0.26%）。 */
    var gdow = dowFromAllStations();
    if (gdow) { state.globalDow = gdow; syncGlobalDow(); }

    /* ④ 重算每站基准（用全量台账，不是只用本批） */
    Object.keys(touchedStations).forEach(function (name) {
      var rec = state.stations[name];
      var st = STATIONS.filter(function (s) { return s.name === name; })[0];
      var dates = Object.keys(rec.byDate);
      rec.days = dates.length;
      var vals = dates.map(function (d) { return rec.byDate[d]; });
      rec.rawMean = mean(vals);
      var sb = strippedOf(st, rec.byDate);
      rec.daily = Math.round(sb != null ? sb : rec.rawMean);
      rec.stripped = sb != null;
      rec.learnCount = (rec.learnCount || 0) + 1;
    });

    /* ⑤ 线路基准：已学站点之和 ÷ 其权重占比，外扩到全线 */
    var lineResults = {};
    ["4", "6"].forEach(function (lid) {
      var lw = Model.lineWeights(lid);
      var knownSum = 0, knownShare = 0, n = 0;
      lw.forEach(function (x) {
        var c = state.stations[x.st.name];
        if (c && c.daily > 0) { knownSum += c.daily; knownShare += x.share; n++; }
      });
      if (knownShare > 0 && n > 0) {
        state.lines[lid] = {
          daily: Math.round(knownSum / knownShare),
          knownStations: n,
          totalStations: lw.length,
          coverage: +(knownShare * 100).toFixed(1),
          samples: totalRecords()
        };
        lineResults[lid] = state.lines[lid];
      }
    });

    save();

    /* ⑥ 学习后再回测同一批数据 */
    var after = backtest(records, weather);

    /* ⑦ 记一条学习履历 */
    var ds = records.map(function (r) { return r.date; }).sort();
    var stNames = Array.from(new Set(records.map(function (r) { return r.station; })));
    state.history.push({
      at: new Date().toISOString(),
      file: fileName || "手动导入",
      records: records.length,
      stationCount: stNames.length,
      added: added,
      dateFrom: ds.length ? ds[0] : null,
      dateTo: ds.length ? ds[ds.length - 1] : null,
      beforeMape: before.mape,
      afterMape: after.mape,
      n: after.n
    });
    if (state.history.length > 100) state.history = state.history.slice(-100);

    state.meta = {
      lastLearnAt: new Date().toISOString(),
      lastFile: fileName || null,
      lastBeforeMape: before.mape,
      lastAfterMape: after.mape,
      learnCount: state.history.length,
      totalRecords: totalRecords(),
      totalStations: stationCount(),
      totalDays: totalDays(),
      dateRange: (function () {
        var all = [];
        Object.keys(state.stations).forEach(function (n) {
          all = all.concat(Object.keys(state.stations[n].byDate || {}));
        });
        all.sort();
        return all.length ? all[0] + " ~ " + all[all.length - 1] : "—";
      })()
    };
    save();

    return {
      before: before,
      after: after,
      added: added,
      stationCount: Object.keys(touchedStations).length,
      lineResults: lineResults,
      globalDow: gdow
    };
  }

  /* 兼容旧调用名 */
  function apply(records, weather) { return learn(records, weather, null); }

  /* ---------------- 清空 ---------------- */
  function clearAll() {
    state = blank();
    try { localStorage.removeItem(KEY); } catch (e) {}
    if (DEFAULT_DOW) {
      for (var k in DEFAULT_DOW) DOW_COEF[k] = DEFAULT_DOW[k];
    } else {
      DOW_COEF[1] = 1.01; DOW_COEF[2] = 1.00; DOW_COEF[3] = 1.00; DOW_COEF[4] = 1.02;
      DOW_COEF[5] = 1.10; DOW_COEF[6] = 0.92; DOW_COEF[0] = 0.86;
    }
  }

  /* ---------------- 档案导出 / 导入 ---------------- */
  function exportJSON() {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      app: "xiamen-metro-lines",
      schema: 2,
      state: state
    }, null, 2);
  }

  function importJSON(txt) {
    var o = JSON.parse(txt);
    var inc = (o && o.state) ? o.state : o;
    if (!inc || !inc.stations) return false;

    /* 合并而不是覆盖：导入的台账并入现有台账，同日期以导入值为准 */
    Object.keys(inc.stations).forEach(function (name) {
      var src = inc.stations[name];
      var dst = state.stations[name];
      if (!dst) {
        dst = state.stations[name] = {
          byDate: {}, days: 0, daily: src.daily || 0, rawMean: src.rawMean || 0,
          stripped: !!src.stripped, firstAt: src.firstAt || null, lastAt: src.lastAt || null
        };
      }
      var sb = src.byDate || {};
      Object.keys(sb).forEach(function (d) { dst.byDate[d] = sb[d]; });
      if (!Object.keys(dst.byDate).length && src.daily) {
        dst.legacyDaily = src.daily;
        dst.legacyDays = src.days || 1;
        dst.daily = src.daily;
      }
      var ds = Object.keys(dst.byDate).sort();
      dst.days = ds.length || dst.days || 0;
      if (ds.length) { dst.firstAt = ds[0]; dst.lastAt = ds[ds.length - 1]; dst.daily = Math.round(mean(ds.map(function (d) { return dst.byDate[d]; }))); }
    });

    if (inc.history && inc.history.length) {
      state.history = state.history.concat(inc.history).slice(-100);
    }
    var gdow = dowFromAllStations();
    if (gdow) state.globalDow = gdow;
    syncGlobalDow();
    save();
    return true;
  }

  captureDefaultDow();
  load();

  return {
    getLineCalibration: getLineCalibration,
    getStationCalibration: getStationCalibration,
    meta: meta,
    history: history,
    isEmpty: isEmpty,
    stationCount: stationCount,
    totalDays: totalDays,
    totalRecords: totalRecords,
    backtest: backtest,
    learn: learn,
    apply: apply,
    clearAll: clearAll,
    exportJSON: exportJSON,
    importJSON: importJSON,
    mape: mape,
    get updatedAt() { return state.updatedAt; },
    get raw() { return state; }
  };
})();
