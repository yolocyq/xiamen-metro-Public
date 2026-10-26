/* =====================================================================
 * calib.js — 校准层
 *
 * 作用：把用户导入的真实客流数据，反哺成模型参数，并给出回测精度。
 *
 * 校准链路：
 *   原始记录 → 聚合 (站 × 日期) → 站点日均 + 周内系数
 *            → 线路基准重算    → 覆盖 Model 参数
 *            → 重新回测同一批数据 → 输出 MAPE / MAE / RMSE / 偏差
 *
 * 所有结果写入 localStorage，刷新后仍然生效；用户可一键清除回到推算态。
 * =================================================================== */

var Calib = (function () {

  var KEY = "xmMetroCalib_v1";
  var state = { lines: {}, stations: {}, globalDow: null, meta: {}, updatedAt: null };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        state = JSON.parse(raw);
        if (!state.lines) state.lines = {};
        if (!state.stations) state.stations = {};
      }
    } catch (e) { /* localStorage 不可用（如 file:// 隐私模式），降级为不持久化 */ }
    syncGlobalDow();
  }
  function save() {
    state.updatedAt = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  /* 把校准得到的全局周内系数写回到 DOW_COEF 常量上 */
  function syncGlobalDow() {
    if (state.globalDow) {
      for (var k in state.globalDow) DOW_COEF[k] = state.globalDow[k];
    }
  }

  function getLineCalibration(lineId) {
    return state.lines[lineId] || null;
  }
  function getStationCalibration(name) {
    return state.stations[name] || null;
  }
  function meta() { return state.meta || {}; }
  function isEmpty() {
    return Object.keys(state.stations).length === 0 && Object.keys(state.lines).length === 0;
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
  /* 决定系数 R² */
  function r2(pairs) {
    if (pairs.length < 2) return null;
    var as = pairs.map(function (p) { return p.actual; });
    var m = mean(as);
    var ssTot = as.reduce(function (a, v) { return a + Math.pow(v - m, 2); }, 0);
    if (!ssTot) return null;
    var ssRes = pairs.reduce(function (a, p) { return a + Math.pow(p.actual - p.pred, 2); }, 0);
    return 1 - ssRes / ssTot;
  }

  /* ---------------- 回测：用当前模型预测每条记录 ---------------- */
  /* records: [{station, date, inbound}] */
  function backtest(records, weather) {
    var pairs = [], miss = [];
    records.forEach(function (r) {
      var st = STATIONS.filter(function (s) { return s.name === r.station; })[0];
      if (!st) { miss.push(r.station); return; }
      if (st.status !== "open") return;
      var p = Model.predictStation(st, r.date, weather || null);
      if (p.closed) return;
      pairs.push({ station: r.station, date: r.date, pred: p.daily, actual: r.inbound });
    });
    return {
      pairs: pairs,
      unmatched: Array.from(new Set(miss)),
      n: pairs.length,
      mape: mape(pairs), mae: mae(pairs), rmse: rmse(pairs), bias: bias(pairs), r2: r2(pairs)
    };
  }

  /* ---------------- 从记录计算站点参数 ---------------- */
  function stationStats(records) {
    /* 同名站可能有多天数据，按 (station) 聚合 */
    var byName = {};
    records.forEach(function (r) {
      if (!byName[r.station]) byName[r.station] = [];
      byName[r.station].push(r);
    });
    var out = {};
    Object.keys(byName).forEach(function (name) {
      var arr = byName[name];
      /* 同一天多条：求和（可能是分时数据已由调用方聚合，这里做兜底） */
      var byDate = {};
      arr.forEach(function (r) {
        byDate[r.date] = (byDate[r.date] || 0) + (Number(r.inbound) || 0);
      });
      var dates = Object.keys(byDate).sort();
      var vals = dates.map(function (d) { return byDate[d]; });
      out[name] = {
        daily: mean(vals),
        days: dates.length,
        min: Math.min.apply(null, vals),
        max: Math.max.apply(null, vals),
        dailyRecords: byDate
      };
    });
    return out;
  }

  /* ---------------- 全局周内系数 ---------------- */
  function globalDowCoef(stats) {
    /* 对每个站，先算该站自身均值，再看每个 dow 相对该站均值的比值，最后跨站平均 */
    var acc = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    Object.keys(stats).forEach(function (name) {
      var s = stats[name];
      if (s.days < 7) return;   /* 样本不足 7 天的站，不参与周内系数标定 */
      var m = s.daily;
      if (!m) return;
      Object.keys(s.dailyRecords).forEach(function (d) {
        var w = Model.dow(d);
        acc[w].push(s.dailyRecords[d] / m);
      });
    });
    var out = {}, any = false;
    for (var k in acc) {
      if (acc[k].length) { out[k] = +mean(acc[k]).toFixed(3); any = true; }
    }
    return any ? out : null;
  }

  /* ---------------- 反算「稳定期基准」 ---------------- */
  /* 关键一步：用户提供的某天客流，是 稳定期基准 × 当日日历系数 × 当日尝鲜系数 × 票制系数 的结果。
   * 如果想得到可复用的基准，必须把这些暂时性系数除掉；
   * 否则新线开通初期的尝鲜峰值会被当成常态写进基准，之后每一天都会高估。
   * （这一条是本项目踩过的坑：直接取日均，会把约 1.33 倍的系数吃进基准。） */
  function strippedBase(st, byDate) {
    var vals = [];
    Object.keys(byDate).forEach(function (d) {
      var g = Model.calendarFactor(st, d).coef
        * Model.noveltyFactor(st.line, d).value
        * Model.fareFactor().value;
      if (g > 0.01) vals.push(byDate[d] / g);
    });
    return vals.length ? mean(vals) : null;
  }

  /* ---------------- 主流程：应用校准 ---------------- */
  /* 返回 { applied, lineResults, stationCount, before, after, globalDow } */
  function apply(records, weather) {
    var before = backtest(records, weather);

    var stats = stationStats(records);
    var gdow = globalDowCoef(stats);

    /* 1) 写站点基准（用剥离系数后的稳定期基准） */
    Object.keys(stats).forEach(function (name) {
      var st = STATIONS.filter(function (s) { return s.name === name; })[0];
      var rawMean = stats[name].daily;
      var sb = st ? strippedBase(st, stats[name].dailyRecords) : null;
      state.stations[name] = {
        daily: Math.round(sb != null ? sb : rawMean),
        rawMean: Math.round(rawMean),
        days: stats[name].days,
        stripped: sb != null,
        source: "user"
      };
    });

    /* 2) 写周内系数 */
    if (gdow) state.globalDow = gdow;

    /* 3) 重算线路基准：
     *    已导入站的实际日均之和 + 未导入站用原权重占比外扩 */
    var lineResults = {};
    ["4", "6"].forEach(function (lid) {
      var lw = Model.lineWeights(lid);
      var knownSum = 0, knownShare = 0;
      lw.forEach(function (x) {
        var c = state.stations[x.st.name];
        if (c) { knownSum += c.daily; knownShare += x.share; }
      });
      if (knownShare > 0) {
        var total = knownSum / knownShare;
        state.lines[lid] = {
          daily: Math.round(total),
          knownStations: lw.filter(function (x) { return !!state.stations[x.st.name]; }).length,
          totalStations: lw.length,
          coverage: +(knownShare * 100).toFixed(1)
        };
        lineResults[lid] = state.lines[lid];
      }
    });

    state.meta = {
      recordCount: records.length,
      stationCount: Object.keys(stats).length,
      dateRange: (function () {
        var ds = records.map(function (r) { return r.date; }).sort();
        return ds.length ? ds[0] + " ~ " + ds[ds.length - 1] : "—";
      })(),
      before: { mape: before.mape, bias: before.bias, n: before.n }
    };

    syncGlobalDow();
    save();

    /* 4) 用新参数再回测一次 */
    var after = backtest(records, weather);
    state.meta.after = { mape: after.mape, bias: after.bias, n: after.n };
    save();

    return {
      applied: true,
      lineResults: lineResults,
      stationCount: Object.keys(stats).length,
      globalDow: gdow,
      before: before,
      after: after
    };
  }

  function clearAll() {
    state = { lines: {}, stations: {}, globalDow: null, meta: {}, updatedAt: null };
    try { localStorage.removeItem(KEY); } catch (e) {}
    /* 恢复默认周内系数 */
    DOW_COEF[1] = 1.01; DOW_COEF[2] = 1.00; DOW_COEF[3] = 1.00; DOW_COEF[4] = 1.02;
    DOW_COEF[5] = 1.10; DOW_COEF[6] = 0.92; DOW_COEF[0] = 0.86;
  }

  /* 导出校准结果为 JSON（便于备份 / 复用到其他环境） */
  function exportJSON() {
    return JSON.stringify({ exportedAt: new Date().toISOString(), state: state }, null, 2);
  }

  function importJSON(txt) {
    var o = JSON.parse(txt);
    if (o && o.state) {
      state = o.state;
      if (!state.lines) state.lines = {};
      if (!state.stations) state.stations = {};
      syncGlobalDow(); save();
      return true;
    }
    return false;
  }

  load();

  return {
    getLineCalibration: getLineCalibration,
    getStationCalibration: getStationCalibration,
    meta: meta,
    isEmpty: isEmpty,
    backtest: backtest,
    apply: apply,
    clearAll: clearAll,
    exportJSON: exportJSON,
    importJSON: importJSON,
    stationStats: stationStats,
    globalDowCoef: globalDowCoef,
    get updatedAt() { return state.updatedAt; },
    get raw() { return state; }
  };
})();
