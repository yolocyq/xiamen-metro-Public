/* =====================================================================
 * model.js — 预测模型层
 *
 * 总体结构：   站点日客流 = 线路日基准 × 站权重占比 × 日历系数 × 天气系数 × 票制系数
 * 再叠加：     新线尝鲜衰减 novelty(t)
 * 分布式输出： 24 小时曲线（按站点类型取形）
 *
 * 每个预测都返回 trace[]，把每一步的中间值暴露出来，
 * 目的是让使用者能对着公式逐项核对，而不是给一个黑箱数字。
 * =================================================================== */

var Model = (function () {

  /* 统一取整：所有对外客流数值四舍五入到千位 */
  function roundK(n) { return Math.round((Number(n) || 0) / 1000) * 1000; }

  /* ---------- 工具 ---------- */
  function parseDate(s) {
    if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
    var p = String(s).split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function ymd(d) {
    var m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (dd < 10 ? "0" : "") + dd;
  }
  function daysBetween(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / 86400000);
  }
  function dow(dateStr) { return parseDate(dateStr).getDay(); }

  /* ---------- 日历类型判定 ---------- */
  function dayClass(dateStr) {
    var key = ymd(parseDate(dateStr));
    if (HOLIDAYS_2026.holiday[key]) return "holiday";
    if (HOLIDAYS_2026.makeupWorkday[key]) return "makeup";   /* 调休补班，按工作日处理 */
    var w = dow(key);
    if (w === 0) return "sunday";
    if (w === 6) return "saturday";
    return "weekday";
  }

  /* ---------- 站点权重 ---------- */
  /* 权重法的核心假设：在无真实客流数据的情况下，
   * 站点客流吸引力可由「类型 + 换乘接入数 + 是否端点 + 腹地等级」线性加总近似。
   *
   * 与试乘首日媒体统计的对照：模型算出的第 1 名是官任，与该日唯一破万的站一致；
   * 但媒体 Top5 中的角江路、角美中心、角海路并未进入模型前 5 名。
   * 原因是首日的免费跨市尝鲜把漳州角美段短期推高，而本模型估计的是常态。
   * 这个差异是结构性的，不应表述为「完全吻合」。 */
  function stationWeight(st) {
    var base = TYPE_WEIGHT[st.type] || 0.6;
    var tr = (st.transfers ? st.transfers.length : 0) * W_TRANSFER;
    var tm = st.terminal ? W_TERMINAL : 0;
    var ca = (st.catchment || 2) * W_CATCHMENT;
    var total = base + tr + tm + ca;
    return {
      total: total,
      detail: [
        { item: "类型「" + st.type + "」基重", value: base },
        { item: "换乘接入 " + (st.transfers ? st.transfers.length : 0) + " 条", value: +tr.toFixed(3) },
        { item: st.terminal ? "端点站加成" : "非端点站", value: tm },
        { item: "腹地等级 " + (st.catchment || 2) + "/5", value: +ca.toFixed(3) }
      ]
    };
  }

  /* 线路内所有运营站的权重归一化占比 */
  function lineWeights(lineId) {
    var list = STATIONS.filter(function (s) { return s.line === lineId && s.status === "open"; });
    var ws = list.map(function (s) { return { st: s, w: stationWeight(s).total }; });
    var sum = ws.reduce(function (a, b) { return a + b.w; }, 0);
    ws.forEach(function (x) { x.share = x.w / sum; });
    return ws;
  }

  /* ---------- 新线尝鲜衰减 ---------- */
  /* novelty(t) = 1 + A·e^(−t/τ)，A=0.45，τ=35天
   * 依据：北京交通发展研究院客流成长规律研究（见 data.js ASSUMPTIONS.novelty） */
  function noveltyFactor(lineId, dateStr) {
    if (!RUNTIME.applyNovelty) return { value: 1.0, note: "已关闭尝鲜衰减" };
    var line = LINES[lineId];
    if (!line) return { value: 1.0, note: "未知线路" };
    var t = daysBetween(line.openDate, dateStr);
    if (t < 0) return { value: 1.45, note: "预测日早于开通日，取首日上限 1.45" };
    var v = 1 + 0.45 * Math.exp(-t / 35);
    return {
      value: v,
      note: "开通后第 " + t + " 天 · novelty = 1 + 0.45×e^(−" + t + "/35) = " + v.toFixed(3)
    };
  }

  /* ---------- 票制系数 ---------- */
  function fareFactor() {
    if (RUNTIME.fareMode === "free") return { value: 1.0, note: "免费试乘模式，系数 1.00" };
    return { value: 0.86, note: "正式收费运营，按需求价格弹性 −0.14 折算，系数 0.86（假设值）" };
  }

  /* ---------- 日历系数 ---------- */
  function calendarFactor(st, dateStr) {
    var cls = dayClass(dateStr);
    var type = st.type;
    if (cls === "holiday") {
      var c = HOLIDAY_TYPE[type] || 1.0;
      return { coef: c, cls: cls, label: "法定节假日", detail: "节假日 × 「" + type + "」= " + c.toFixed(2) };
    }
    if (cls === "makeup") {
      return { coef: 1.0, cls: cls, label: "调休补班", detail: "调休上班日，按普通工作日处理，系数 1.00" };
    }
    if (cls === "saturday") {
      var b = SATURDAY_EXTRA[type] || 1.10;
      return { coef: b, cls: cls, label: "周六", detail: "周六 × 「" + type + "」= " + b.toFixed(2) };
    }
    if (cls === "sunday") {
      var s = WEEKEND_TYPE[type] || 1.0;
      return { coef: s, cls: cls, label: "周日", detail: "周日 × 「" + type + "」= " + s.toFixed(2) };
    }
    var d = dow(dateStr);
    var w = DOW_COEF[d] || 1.0;
    var names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return { coef: w, cls: cls, label: names[d], detail: names[d] + " 周内系数 = " + w.toFixed(2) };
  }

  /* ---------- 天气系数 ---------- */
  function weatherFactor(weather, st) {
    if (!weather || !RUNTIME.applyWeather) return { coef: 1.0, detail: "未设置天气，系数 1.00" };
    var base = WEATHER_COEF[weather];
    if (base === undefined) return { coef: 1.0, detail: "未知天气类型，系数 1.00" };
    /* 枢纽/商圈类站点受天气影响小于纯通勤/景区站 */
    var damp = (st.type === "枢纽" || st.type === "商圈") ? 1 + (base - 1) * 0.7 : 1;
    var coef = 1 + (base - 1) * (damp === 1 ? 1 : 0.7);
    return {
      coef: coef,
      detail: "「" + weather + "」基准 " + base.toFixed(3) + (st.type === "枢纽" || st.type === "商圈" ? "，枢纽/商圈类受天气影响较小，衰减 30%" : "")
    };
  }

  /* ---------- 24 小时分布形态 ---------- */
  /* 返回 24 个非负实数（未归一化），0~5 与 23 点后为运营外 */
  function hourlyShape(st, cls) {
    var h = [], T;
    function gauss(x, mu, sigma) { return Math.exp(-Math.pow(x - mu, 2) / (2 * sigma * sigma)); }

    var flat = 0.012;   /* 全天基底 */

    if (cls === "holiday" || cls === "sunday" || (cls === "saturday")) {
      /* 非通勤日：以 10~21 点的宽平台为主 */
      for (T = 0; T < 24; T++) {
        if (T < 6 || T > 23) { h.push(0); continue; }
        var v = flat
          + 0.72 * gauss(T, 11.0, 1.5)
          + 0.95 * gauss(T, 15.5, 2.4)
          + 0.80 * gauss(T, 19.5, 1.9);
        h.push(Math.max(v, 0.008));
      }
      return h;
    }

    /* 通勤日：按站点类型给出不同双峰形态 */
    var morningAmp, morningMu, morningSig, eveningAmp, eveningMu, eveningSig, midAmp;
    switch (st.type) {
      case "枢纽":
        morningAmp = 0.85; morningMu = 8.3; morningSig = 1.05;
        eveningAmp = 0.95; eveningMu = 18.3; eveningSig = 1.25;
        midAmp = 0.34; break;
      case "换乘":
        morningAmp = 1.00; morningMu = 8.0; morningSig = 0.95;
        eveningAmp = 0.92; eveningMu = 18.2; eveningSig = 1.15;
        midAmp = 0.22; break;
      case "商圈":
        morningAmp = 0.52; morningMu = 8.4; morningSig = 1.00;
        eveningAmp = 0.88; eveningMu = 18.6; eveningSig = 1.55;
        midAmp = 0.62; break;
      case "文教":
        morningAmp = 1.05; morningMu = 7.8; morningSig = 0.82;
        eveningAmp = 0.90; eveningMu = 18.0; eveningSig = 1.10;
        midAmp = 0.30; break;
      case "产业":
        morningAmp = 1.25; morningMu = 8.5; morningSig = 0.72;
        eveningAmp = 1.15; eveningMu = 18.5; eveningSig = 0.80;
        midAmp = 0.16; break;
      case "景区":
        morningAmp = 0.48; morningMu = 9.3; morningSig = 1.30;
        eveningAmp = 0.70; eveningMu = 17.6; eveningSig = 1.70;
        midAmp = 0.78; break;
      default: /* 居住 */
        morningAmp = 1.15; morningMu = 7.7; morningSig = 0.78;
        eveningAmp = 0.72; eveningMu = 18.3; eveningSig = 1.10;
        midAmp = 0.18; break;
    }

    for (T = 0; T < 24; T++) {
      if (T < 6 || T > 23) { h.push(0); continue; }
      var val = flat
        + morningAmp * gauss(T, morningMu, morningSig)
        + eveningAmp * gauss(T, eveningMu, eveningSig)
        + midAmp * gauss(T, 12.6, 1.5);
      h.push(Math.max(val, 0.006));
    }
    return h;
  }

  /* ---------- 线路日基准 ---------- */
  function lineBaseline(lineId, dateStr) {
    var line = LINES[lineId];
    var cal = Calib.getLineCalibration(lineId);
    var stableBase = cal ? cal.daily : line.baselineDailyStable;
    var usedCal = !!cal;

    var nov = noveltyFactor(lineId, dateStr);
    var fare = fareFactor();
    /* 线路级日历系数：用线路主导类型加权，这里简化为各站平均值在 lineDaily 中计算 */
    return {
      stableBase: stableBase,
      usedCal: usedCal,
      novelty: nov,
      fare: fare
    };
  }

  /* ---------- 单站预测 ---------- */
  function predictStation(st, dateStr, weather) {
    if (st.status !== "open") {
      return { closed: true, name: st.name, note: "该站暂缓开通，不产生客流" };
    }
    var lineId = st.line;
    var lw = lineWeights(lineId);
    var self = lw.filter(function (x) { return x.st.name === st.name; })[0];
    var base = lineBaseline(lineId, dateStr);

    var cal = calendarFactor(st, dateStr);
    var wx = weatherFactor(weather, st);

    /* 站点级基准优先：该站若已导入真实数据，直接用校准值；
     * 否则回落到「线路稳定期基准 × 本站权重占比」。 */
    var stCal = Calib.getStationCalibration(st.name);
    var stableBase = stCal ? stCal.daily : (base.stableBase * self.share);
    var daily = stableBase * cal.coef * wx.coef * base.novelty.value * base.fare.value;

    /* 24h 分布 */
    var shape = hourlyShape(st, cal.cls);
    var shapeSum = shape.reduce(function (a, b) { return a + b; }, 0);
    var hourly = shape.map(function (v) { return Math.round(daily * v / shapeSum); });

    /* 修正舍入误差，保证 sum(hourly) === daily */
    var hs = hourly.reduce(function (a, b) { return a + b; }, 0);
    var target = Math.round(daily);
    if (hs !== target && hs > 0) {
      var diff = target - hs, i = 0;
      while (diff !== 0 && i < 500) {
        var idx = i % 24;
        if (hourly[idx] > 0) { hourly[idx] += (diff > 0 ? 1 : -1); diff += (diff > 0 ? -1 : 1); }
        i++;
      }
    }

    var peakH = 0;
    hourly.forEach(function (v, i) { if (v > hourly[peakH]) peakH = i; });

    var u = uncertaintyOf(st, !!Calib.getStationCalibration(st.name));

    return {
      name: st.name,
      line: lineId,
      lineName: LINES[lineId].name,
      color: LINES[lineId].color,
      type: st.type,
      district: st.district,
      date: dateStr,
      dayLabel: cal.label,
      dayClass: cal.cls,
      daily: Math.round(daily),
      share: self.share,
      weight: stationWeight(st),
      hourly: hourly,
      peakHour: peakH,
      peakValue: hourly[peakH],
      morningPeak: sumRange(hourly, 7, 9),
      eveningPeak: sumRange(hourly, 17, 19),
      interval: { low: Math.round(daily * (1 - u)), high: Math.round(daily * (1 + u)), rel: u },
      trace: stCal ? [
        { k: "本站稳定期基准", v: Math.round(stCal.daily), src: "来自导入的真实数据（已剥离当日日历/尝鲜/票制系数）" },
        { k: cal.label + "日历系数", v: cal.coef.toFixed(3), src: cal.detail },
        { k: "天气系数", v: wx.coef.toFixed(3), src: wx.detail },
        { k: "新线尝鲜系数", v: base.novelty.value.toFixed(3), src: base.novelty.note },
        { k: "票制系数", v: base.fare.value.toFixed(3), src: base.fare.note },
        { k: "最终日客流", v: (Math.round(daily/1000)*1000).toLocaleString() + " 人次", src: "以上各项连乘，四舍五入至千位" }
      ] : [
        { k: "线路稳定期日基准", v: Math.round(base.stableBase), src: base.usedCal ? "已用导入数据校准" : "推算值 " + LINES[lineId].baselineReliability + " 级" },
        { k: "本站权重占比", v: (self.share * 100).toFixed(2) + "%", src: "权重 " + self.w.toFixed(3) + " / 线路合计" },
        { k: cal.label + "日历系数", v: cal.coef.toFixed(3), src: cal.detail },
        { k: "天气系数", v: wx.coef.toFixed(3), src: wx.detail },
        { k: "新线尝鲜系数", v: base.novelty.value.toFixed(3), src: base.novelty.note },
        { k: "票制系数", v: base.fare.value.toFixed(3), src: base.fare.note },
        { k: "最终日客流", v: (Math.round(daily/1000)*1000).toLocaleString() + " 人次", src: "以上各项连乘，四舍五入至千位" }
      ]
    };
  }

  function sumRange(arr, a, b) {
    var s = 0;
    for (var i = a; i <= b; i++) s += (arr[i] || 0);
    return s;
  }

  /* ---------- 线路级预测 ---------- */
  function predictLine(lineId, dateStr, weather) {
    var line = LINES[lineId];
    var list = STATIONS.filter(function (s) { return s.line === lineId && s.status === "open"; });
    var rows = list.map(function (s) {
      var r = predictStation(s, dateStr, weather);
      return r;
    }).filter(function (r) { return !r.closed; });

    var hourly = new Array(24).fill(0);
    rows.forEach(function (r) { r.hourly.forEach(function (v, i) { hourly[i] += v; }); });

    var total = rows.reduce(function (a, b) { return a + b.daily; }, 0);
    rows.sort(function (a, b) { return b.daily - a.daily; });

    var peakH = 0;
    hourly.forEach(function (v, i) { if (v > hourly[peakH]) peakH = i; });

    return {
      lineId: lineId,
      lineName: line.name,
      color: line.color,
      date: dateStr,
      total: total,
      hourly: hourly,
      rows: rows,
      peakHour: peakH,
      peakValue: hourly[peakH],
      morningPeak: sumRange(hourly, 7, 9),
      eveningPeak: sumRange(hourly, 17, 19),
      openCount: list.length
    };
  }

  /* ---------- BRT 换乘站专用模型 ---------- */
  /* 与地铁站最大的不同：换乘站的客流几乎全部由「通勤供应链」驱动，
   * 因此采用强双峰模型，而非地铁站的「双峰 + 平峰」结构。
   * 早高峰 7:30—9:00（峰值约 8:00），晚高峰 17:30—19:00（峰值约 18:10），
   * 早峰更尖（上班时间刚性），晚峰更宽（下班时间分散）。 */
  function brtShape(bias, leg) {
    /* leg: "inbound"=进站, "outbound"=出站 */
    function g(x, mu, sg) { return Math.exp(-Math.pow(x - mu, 2) / (2 * sg * sg)); }
    var Am, Ae;
    if (bias === "residential") {          /* 居住导向：早进站为主 */
      Am = 1.00; Ae = 0.52;
    } else if (bias === "employment") {    /* 岗位导向：早出站为主 → 早进站少 */
      Am = 0.50; Ae = 1.00;
    } else {                               /* 双向均衡 */
      Am = 0.85; Ae = 0.85;
    }
    if (leg === "outbound") { var t = Am; Am = Ae; Ae = t; }  /* 出站与进站早晚峰互换 */

    var MU_M = 7.95, SIG_M = 0.62;   /* 早峰：窄而高 */
    var MU_E = 18.15, SIG_E = 0.95;  /* 晚峰：宽而缓 */
    var FLAT = 0.025, MID = 0.10;

    var arr = [];
    for (var T = 0; T < 24; T++) {
      if (T < 6 || T > 23) { arr.push(0); continue; }
      var v = FLAT + Am * g(T, MU_M, SIG_M) + Ae * g(T, MU_E, SIG_E) + MID * g(T, 12.6, 1.3);
      arr.push(Math.max(v, 0.006));
    }
    return arr;
  }

  /* 单座 BRT 换乘站的换乘客流预测 */
  function predictBRT(bt, dateStr, weather) {
    /* 找到对应的地铁线路与该站 Metro 侧的日客流 */
    var lineId = bt.metroLine;
    var metroSt = STATIONS.filter(function (s) {
      return s.brt === true && s.line === lineId && s.name === bt.station;
    })[0];

    /* 地铁侧总客流 = 本平台库内的新线侧 + metroAlso 指定的老三线侧。
     * 不这么加的话，厦门北站就只会算到 4 号线侧那点量，
     * 而它实际是 1 号线 + 4 号线 + BRT + 高铁的复合枢纽。 */
    var metroDaily = 0, metroParts = [];
    if (metroSt) {
      var pr = Model.predictStation(metroSt, dateStr, weather);
      metroDaily += pr.daily;
      metroParts.push(LINES[lineId].name + "侧 " + Math.round(pr.daily).toLocaleString());
    }
    var legacyLines = (bt.metroAlso || []).length;
    var legacyOnly = !metroSt;
    if (legacyOnly || legacyLines > 0) {
      var lv = estimateLegacyBRTStation(bt, dateStr);
      metroDaily += lv * (legacyOnly ? 1 : legacyLines);
      metroParts.push((bt.metroAlso || []).join("、") + "侧 " + Math.round(lv * (legacyOnly ? 1 : legacyLines)).toLocaleString());
    }
    var metroSrc = metroParts.length ? metroParts.join(" + ") : "未匹配到站点资料";

    /* 换乘系数：换乘站在总客流中的换乘客流占比 */
    /* 取值逻辑：4/6 号线新接入站因"网络效应"（见 ASSUMPTIONS.network_effect）取值更高 */
    var isNew = (bt.metroLine === "4" || bt.metroLine === "6");
    var cls = dayClass(dateStr);
    var transferRatio = isNew ? 0.34 : 0.28;
    if (cls === "holiday") transferRatio *= 0.82;
    else if (cls === "saturday" || cls === "sunday") transferRatio *= 0.90;

    var daily = metroDaily * transferRatio;

    var shapeIn = brtShape(bt.peakBias, "inbound");
    var shapeOut = brtShape(bt.peakBias, "outbound");
    var sIn = shapeIn.reduce(function (a, b) { return a + b; }, 0);
    var sOut = shapeOut.reduce(function (a, b) { return a + b; }, 0);

    var hIn = shapeIn.map(function (v) { return Math.round(daily * v / sIn); });
    var hOut = shapeOut.map(function (v) { return Math.round(daily * v / sOut); });
    var hTotal = hIn.map(function (v, i) { return v + hOut[i]; });

    var peakH = 0;
    hTotal.forEach(function (v, i) { if (v > hTotal[peakH]) peakH = i; });

    var u = isNew ? 0.38 : 0.34;

    return {
      station: bt.station,
      metroLine: bt.metroLine,
      brtLine: bt.brtLine,
      peakBias: bt.peakBias,
      peakBiasText: { residential: "居住导向（早高峰进站占优）", employment: "岗位导向（早高峰出站占优）", balanced: "双向均衡" }[bt.peakBias],
      date: dateStr,
      dayLabel: require_calendarLabel(dateStr),
      metroDaily: Math.round(metroDaily),
      metroSrc: metroSrc,
      transferRatio: transferRatio,
      daily: Math.round(daily),
      hourlyIn: hIn,
      hourlyOut: hOut,
      hourlyTotal: hTotal,
      peakHour: peakH,
      peakValue: hTotal[peakH],
      morningPeak: sumRange(hTotal, 7, 9),
      eveningPeak: sumRange(hTotal, 17, 19),
      morningShare: 0,
      eveningShare: 0,
      interval: { low: Math.round(daily * (1 - u)), high: Math.round(daily * (1 + u)), rel: u },
      isNew: isNew
    };
  }

  function require_calendarLabel(dateStr) {
    var c = dayClass(dateStr);
    return { holiday: "法定节假日", makeup: "调休补班", saturday: "周六", sunday: "周日", weekday: "工作日" }[c];
  }

  /* 老三线 BRT 换乘站的规模类比估算 */
  function estimateLegacyBRTStation(bt, dateStr) {
    /* 基准：2025 年地铁日均 75.34 万 / 全网约 90 站 ≈ 站均 8,400；
     * 换乘大站取站均的 1.6~2.4 倍（厦门北站为高铁枢纽，取最高）。该乘子为推算值。 */
    var base = 8400;
    var mult = { "厦门北站": 2.6, "文灶": 2.0, "蔡塘": 1.8, "火车站": 2.2, "双十中学": 1.6, "华侨大学": 1.9, "官浔": 1.4 }[bt.station] || 1.8;
    var cls = dayClass(dateStr);
    var clsCoef = { holiday: 1.35, saturday: 1.10, sunday: 1.05, makeup: 1.0, weekday: 1.0 }[cls];
    return base * mult * clsCoef;
  }

  /* ---------- 不确定度 ---------- */
  /* 未校准：线路基准 D 级 ±30%，站权重 ±15%，日历/天气 ±6% → 合成约 34%
   * 已校准（用户导入真实数据）：基准 ±10%，权重 ±3%，日历 ±4% → 合成约 11% */
  function uncertaintyOf(st, calibrated) {
    if (calibrated) return Math.sqrt(0.10 * 0.10 + 0.03 * 0.03 + 0.04 * 0.04);
    return Math.sqrt(0.30 * 0.30 + 0.15 * 0.15 + 0.06 * 0.06);
  }

  /* ---------- 全网/双线汇总 ---------- */
  function predictAll(dateStr, weather) {
    var l4 = predictLine("4", dateStr, weather);
    var l6 = predictLine("6", dateStr, weather);
    var brtList = BRT_TRANSFER.map(function (b) { return predictBRT(b, dateStr, weather); });
    var brtTotal = brtList.reduce(function (a, b) { return a + b.daily; }, 0);

    var hourly = new Array(24).fill(0);
    l4.hourly.forEach(function (v, i) { hourly[i] += v; });
    l6.hourly.forEach(function (v, i) { hourly[i] += v; });

    return {
      date: dateStr,
      l4: l4, l6: l6,
      total: l4.total + l6.total,
      hourly: hourly,
      brtList: brtList,
      brtTotal: brtTotal,
      peakHour: (function () { var p = 0; hourly.forEach(function (v, i) { if (v > hourly[p]) p = i; }); return p; })(),
      transferTotal: brtList.filter(function (b) { return b.isNew; }).reduce(function (a, b) { return a + b.daily; }, 0)
    };
  }

  /* ---------- 对外接口 ---------- */
  return {
    parseDate: parseDate, ymd: ymd, dayClass: dayClass, dow: dow,
    daysBetween: daysBetween,
    stationWeight: stationWeight, lineWeights: lineWeights,
    noveltyFactor: noveltyFactor, fareFactor: fareFactor,
    calendarFactor: calendarFactor, weatherFactor: weatherFactor,
    hourlyShape: hourlyShape, brtShape: brtShape,
    predictStation: predictStation, predictLine: predictLine,
    predictBRT: predictBRT, predictAll: predictAll,
    uncertaintyOf: uncertaintyOf, sumRange: sumRange
  };
})();
