/* =====================================================================
 * app.js — 界面层
 * 负责：导航、渲染、图表绘制、真实数据导入与回测交互
 * =================================================================== */

var App = (function () {

  var S = {
    date: todayStr(),
    weather: "晴",
    lineId: "4",
    station: "",
    brtIdx: 0,
    records: [],        /* 导入的记录 */
    fields: {},         /* 字段映射 */
    charts: {}          /* Chart 实例池 */
  };

  function todayStr() { return Model.ymd(new Date()); }
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function fmt(n) { return Math.round(n).toLocaleString("zh-CN"); }
  function pct(n, d) { return n == null ? "—" : (n * 100).toFixed(d == null ? 1 : d) + "%"; }

  function relTag(r) {
    var map = { A: ["官方发布", "rel-a"], B: ["媒体报道", "rel-b"], C: ["文献经验", "rel-c"], D: ["平台推算", "rel-d"] };
    var m = map[r] || map.D;
    return '<span class="rel ' + m[1] + '" title="' + m[0] + '">' + r + '</span>';
  }

  /* ---------- 图表 ---------- */
  function chart(key, canvasId, cfg) {
    if (typeof Chart === "undefined") {
      var cv = $(canvasId);
      if (cv) {
        cv.style.display = "none";
        var f = document.createElement("div");
        f.className = "chart-fail on";
        f.textContent = "图表库未能加载（chart.umd.min.js 缺失或被拦截）";
        cv.parentNode.appendChild(f);
      }
      return null;
    }
    if (S.charts[key]) { try { S.charts[key].destroy(); } catch (e) {} }
    var cv = $(canvasId);
    if (!cv) return null;
    cv.style.display = "";
    var ex = cv.parentNode.querySelector(".chart-fail");
    if (ex) ex.remove();
    var c = new Chart(cv.getContext("2d"), cfg);
    S.charts[key] = c;
    return c;
  }

  var GRID = { color: "#e8edf3", drawBorder: false };
  var TICK = { color: "#8a99a8", font: { size: 11 } };

  function baseOpts(extra) {
    var o = {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#5a6b7d", font: { size: 12 }, boxWidth: 12, usePointStyle: true } },
        tooltip: {
          backgroundColor: "rgba(15,34,51,.94)", titleFont: { size: 12 }, bodyFont: { size: 12 },
          padding: 9, cornerRadius: 6, displayColors: true
        }
      },
      scales: {
        x: { grid: GRID, ticks: TICK },
        y: { grid: GRID, ticks: Object.assign({}, TICK, { callback: function (v) { return fmt(v); } }) }
      }
    };
    return Object.assign(o, extra || {});
  }

  var HOURS = [];
  for (var i = 0; i < 24; i++) HOURS.push(i + "时");

  /* ================= 1. 总览 ================= */
  function renderOverview() {
    var all = Model.predictAll(S.date, S.weather);
    var l4 = all.l4, l6 = all.l6;

    var legacy = estimateLegacy();
    var total = all.total;
    var u = Math.sqrt(Math.pow(0.30, 2) + Math.pow(0.15, 2) + Math.pow(0.06, 2));

    $("ovKpi").innerHTML = [
      kpi("双线预测总客流", fmt(total), "人次/日",
        "区间 " + fmt(total * (1 - u)) + " ~ " + fmt(total * (1 + u)),
        "4 号线 + 6 号线合计 · " + S.dayLabel, ""),
      kpi("4 号线", fmt(l4.total), "人次/日",
        l4.openCount + " 座运营站 · 峰值 " + l4.peakHour + " 时", "", "k4"),
      kpi("6 号线", fmt(l6.total), "人次/日",
        l6.openCount + " 座运营站 · 峰值 " + l6.peakHour + " 时", "", "k6"),
      kpi("BRT 换乘客流", fmt(all.brtTotal), "人次/日",
        "7 座换乘站合计 · 其中新线贡献 " + fmt(all.transferTotal), "", "kb"),
      kpi("全网参考量级", fmt(total + legacy), "人次/日",
        "含老三线估算 " + fmt(legacy) + "（" + S.dayLabel + "口径）", "", ""),
      kpi("早高峰小时量", fmt(Model.sumRange(all.hourly, 7, 9)), "人次",
        "7:00—9:59 三小时累计", "", ""),
      kpi("晚高峰小时量", fmt(Model.sumRange(all.hourly, 17, 19)), "人次",
        "17:00—19:59 三小时累计", "", ""),
      kpi("不确定度", "±" + Math.round(u * 100) + "%", "",
        "未校准：线路基准±30% · 站权重±15% · 日历天气±6%", "", "")
    ].join("");

    /* 双线 24h 曲线 */
    chart("ovHour", "cOvHour", {
      type: "line",
      data: {
        labels: HOURS,
        datasets: [
          { label: "4 号线", data: l4.hourly, borderColor: "#E60012", backgroundColor: "rgba(230,0,18,.14)", fill: true, tension: .35, pointRadius: 2, borderWidth: 2 },
          { label: "6 号线", data: l6.hourly, borderColor: "#7B2CBF", backgroundColor: "rgba(123,44,191,.14)", fill: true, tension: .35, pointRadius: 2, borderWidth: 2 }
        ]
      },
      options: baseOpts()
    });

    /* 构成 */
    chart("ovLine", "cOvLine", {
      type: "doughnut",
      data: {
        labels: ["4 号线", "6 号线", "BRT 换乘"],
        datasets: [{ data: [l4.total, l6.total, all.brtTotal], backgroundColor: ["#E60012", "#7B2CBF", "#008752"], borderWidth: 2, borderColor: "#fff" }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "58%",
        plugins: {
          legend: { position: "bottom", labels: { color: "#5a6b7d", font: { size: 12 }, boxWidth: 12, usePointStyle: true } },
          tooltip: {
            backgroundColor: "rgba(15,34,51,.94)", padding: 9, cornerRadius: 6,
            callbacks: { label: function (c) { return c.label + "：" + fmt(c.raw) + " 人次（" + (c.raw / (l4.total + l6.total + all.brtTotal) * 100).toFixed(1) + "%）"; } }
          }
        }
      }
    });

    /* 站点排行 */
    var rows = l4.rows.concat(l6.rows).sort(function (a, b) { return b.daily - a.daily; });
    var h = '<thead><tr><th style="width:44px">#</th><th>站名</th><th>线路</th><th>行政区</th><th>站点类型</th><th class="num">权重</th><th class="num">占比</th><th class="num">预测日客流</th><th class="num">早高峰 7-9时</th></tr></thead><tbody>';
    rows.forEach(function (r, i) {
      var rc = i < 3 ? " r" + (i + 1) : "";
      h += '<tr><td><span class="rank' + rc + '">' + (i + 1) + '</span></td>'
        + '<td><b>' + esc(r.name) + '</b></td>'
        + '<td><span class="tag t-line' + r.line + '">' + esc(r.lineName) + '</span></td>'
        + '<td>' + esc(r.district) + '</td>'
        + '<td><span class="tag t-gray">' + esc(r.type) + '</span></td>'
        + '<td class="num">' + r.weight.total.toFixed(3) + '</td>'
        + '<td class="num">' + pct(r.share, 2) + '</td>'
        + '<td class="num"><b>' + fmt(r.daily) + '</b></td>'
        + '<td class="num">' + fmt(r.morningPeak) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td colspan="7">合计</td><td class="num">' + fmt(total) + '</td><td class="num">' + fmt(Model.sumRange(all.hourly, 7, 9)) + '</td></tr></tfoot>';
    $("ovRank").innerHTML = h;

    /* 锚点 */
    renderAnchors();
  }

  function kpi(lb, vl, unit, ex, rg, cls) {
    return '<div class="kpi ' + (cls || "") + '">'
      + '<div class="lb">' + esc(lb) + '</div>'
      + '<div class="vl">' + vl + (unit ? '<small>' + unit + '</small>' : '') + '</div>'
      + (ex ? '<div class="ex">' + ex + '</div>' : '')
      + (rg ? '<div class="rg">' + rg + '</div>' : '')
      + '</div>';
  }

  /* 老三线参考量级：按观测基线 80 万 × 当日周内系数粗略换算 */
  function estimateLegacy() {
    var cls = Model.dayClass(S.date);
    var base = 800000;
    var c = { holiday: 1.32, saturday: 1.06, sunday: 1.02, makeup: 1.0, weekday: 1.0 }[cls];
    if (cls === "weekday") {
      var w = Model.dow(S.date);
      if (w === 5) c = 1.10;
    }
    return Math.round(base * c);
  }

  function renderAnchors() {
    var h = "";
    ANCHORS.forEach(function (a) {
      h += '<details class="tr"' + (a.date === "2026-09-16" ? " open" : "") + '><summary>'
        + esc(a.date) + ' · ' + esc(a.label) + '　（' + a.metrics.length + ' 项观测）</summary><div class="tr-body">'
        + '<table class="tbl"><thead><tr><th style="width:60px">可靠度</th><th style="width:200px">指标</th><th style="width:130px">数值</th><th>说明</th></tr></thead><tbody>';
      a.metrics.forEach(function (m) {
        h += '<tr><td>' + relTag(m.rel) + '</td>'
          + '<td>' + esc(m.text) + '</td>'
          + '<td class="num">' + (m.value == null ? "—" : fmt(m.value) + " " + m.unit) + '</td>'
          + '<td style="color:#5a6b7d;font-size:12.5px">' + esc(m.detail) + '</td></tr>';
      });
      h += '</tbody></table></div></details>';
    });
    h += '<div class="note note-warn" style="margin-top:12px">'
      + '<b>重要：</b>9 月 16 日全网 92.05 万 = 1 号线 36.14 + 2 号线 30.90 + 3 号线 25.01，三者相加恰好等于全网数。'
      + '这反证了试乘期间 4、6 号线客流<b>未计入官方统计</b>。因此本平台的双线预测值不能简单地与「全网客流」相加，'
      + '二者口径不同。</div>';
    $("ovAnchor").innerHTML = h;
  }

  /* ================= 2. 线路页 ================= */
  function initLinePage() {
    var sel = $("lnSel");
    sel.innerHTML = Object.keys(LINES).map(function (k) {
      return '<option value="' + k + '"' + (k === S.lineId ? " selected" : "") + '>' + esc(LINES[k].fullName) + '</option>';
    }).join("");
    sel.onchange = function () { S.lineId = this.value; S.station = ""; fillStationSel(); renderLinePage(); };
    fillStationSel();
  }
  function fillStationSel() {
    var sel = $("stSel");
    var list = STATIONS.filter(function (s) { return s.line === S.lineId; });
    sel.innerHTML = '<option value="">— 整条线路汇总 —</option>' + list.map(function (s) {
      return '<option value="' + esc(s.name) + '"' + (s.name === S.station ? " selected" : "") + '>'
        + esc(s.name) + (s.status === "pending" ? "（暂缓开通）" : "") + '</option>';
    }).join("");
    sel.onchange = function () { S.station = this.value; renderLinePage(); };
  }

  function renderLinePage() {
    var line = LINES[S.lineId];
    var openDays = Model.daysBetween(line.openDate, S.date);
    var nov = Model.noveltyFactor(S.lineId, S.date);

    /* 线路元信息 */
    var h = '<div class="grid g4">';
    h += card2("线路全长", line.lengthKm + " km", line.designSpeed + " km/h 设计时速");
    h += card2("设站数量", line.stationCountOpen + " / " + line.stationCountTotal, "已运营 / 全线规划");
    h += card2("开通日期", line.openDate, "距今 " + openDays + " 天");
    h += card2("尝鲜系数", nov.value.toFixed(3), "novelty = 1 + 0.45·e^(−" + openDays + "/35)");
    h += '</div>';
    h += '<div style="margin-top:12px"><span class="tag t-line' + S.lineId + '">' + esc(line.name) + '</span> ';
    line.features.forEach(function (f) { h += '<span class="tag t-blue" style="margin-right:5px">' + esc(f) + '</span>'; });
    h += '</div>';
    line.notes.forEach(function (n) {
      h += '<div class="note note-info" style="margin-top:8px">' + esc(n) + '</div>';
    });
    $("lnMeta").innerHTML = h;

    var box = $("lnResult");
    if (!S.station) {
      renderLineSummary(box);
    } else {
      var st = STATIONS.filter(function (s) { return s.line === S.lineId && s.name === S.station; })[0];
      renderStationDetail(box, st);
    }
  }

  function card2(lb, vl, ex) {
    return '<div class="card" style="margin:0;padding:13px 15px">'
      + '<div class="lb" style="font-size:12px;color:#8a99a8;margin-bottom:4px">' + esc(lb) + '</div>'
      + '<div style="font-size:20px;font-weight:650">' + esc(vl) + '</div>'
      + '<div style="font-size:11.5px;color:#8a99a8;margin-top:3px">' + esc(ex) + '</div></div>';
  }

  function renderLineSummary(box) {
    var r = Model.predictLine(S.lineId, S.date, S.weather);
    var maxV = Math.max.apply(null, r.hourly);
    var colors = r.hourly.map(function (v, i) {
      return (i >= 7 && i <= 9) || (i >= 17 && i <= 19) ? hexA(LINES[S.lineId].color, .85) : hexA(LINES[S.lineId].color, .4);
    });

    var h = '<div class="card"><h2>' + esc(r.lineName) + ' 24 小时客流分布</h2>'
      + '<div class="hint">深色柱为早晚高峰时段（7—9 时、17—19 时），合计 ' + fmt(r.total) + ' 人次</div>'
      + '<div class="chart-box tall"><canvas id="cLnHour"></canvas></div></div>';

    h += '<div class="grid g-line">';
    h += '<div class="card"><h2>分站日客流</h2><div class="chart-box tall"><canvas id="cLnRank"></canvas></div></div>';
    h += '<div class="card"><h2>明细表</h2><div class="tbl-wrap"><table class="tbl">'
      + '<thead><tr><th>#</th><th>站名</th><th>类型</th><th class="num">权重</th><th class="num">日客流</th><th class="num">峰值时</th></tr></thead><tbody>';
    r.rows.forEach(function (s, i) {
      h += '<tr><td><span class="rank' + (i < 3 ? " r" + (i + 1) : "") + '">' + (i + 1) + '</span></td>'
        + '<td><b>' + esc(s.name) + '</b></td><td><span class="tag t-gray">' + esc(s.type) + '</span></td>'
        + '<td class="num">' + s.weight.total.toFixed(3) + '</td>'
        + '<td class="num"><b>' + fmt(s.daily) + '</b></td><td class="num">' + s.peakHour + ' 时</td></tr>';
    });
    h += '</tbody></table></div></div></div>';

    /* 暂缓站提示 */
    var pend = STATIONS.filter(function (s) { return s.line === S.lineId && s.status === "pending"; });
    if (pend.length) {
      h += '<div class="card"><h2>暂缓开通站点</h2><div class="hint">下列站点不参与客流预测</div>';
      pend.forEach(function (s) {
        h += '<div class="note note-warn"><b>' + esc(s.name) + '</b>（' + esc(s.district) + '）　'
          + '在本地宝首末班时刻表中无运营时刻，判定为暂缓开通。'
          + '若实际情况不同，可直接修改 data.js 中的 status 字段。</div>';
      });
      h += '</div>';
    }

    box.innerHTML = h;

    chart("lnHour", "cLnHour", {
      type: "bar",
      data: {
        labels: HOURS,
        datasets: [{ label: r.lineName + " 分时客流", data: r.hourly, backgroundColor: colors, borderRadius: 3, borderSkipped: false }]
      },
      options: baseOpts({ plugins: { legend: { display: false }, tooltip: baseOpts().plugins.tooltip } })
    });

    chart("lnRank", "cLnRank", {
      type: "bar",
      data: {
        labels: r.rows.map(function (s) { return s.name; }),
        datasets: [{ label: "日客流", data: r.rows.map(function (s) { return s.daily; }), backgroundColor: LINES[S.lineId].color, borderRadius: 3 }]
      },
      options: baseOpts({
        indexAxis: "y",
        plugins: { legend: { display: false }, tooltip: baseOpts().plugins.tooltip },
        scales: { x: { grid: GRID, ticks: Object.assign({}, TICK, { callback: function (v) { return fmt(v); } }) }, y: { grid: { display: false }, ticks: { color: "#5a6b7d", font: { size: 11 } } } }
      })
    });
  }

  function hexA(hex, a) {
    var c = hex.replace("#", "");
    var r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }

  function renderStationDetail(box, st) {
    if (!st) { box.innerHTML = '<div class="card">未找到该站点</div>'; return; }
    if (st.status === "pending") {
      box.innerHTML = '<div class="card"><h2>' + esc(st.name) + '</h2>'
        + '<div class="note note-danger">该站暂缓开通，不产生客流，因此不参与预测。</div></div>';
      return;
    }
    var p = Model.predictStation(st, S.date, S.weather);
    var lc = Calib.getLineCalibration(st.line);
    var stCal = Calib.getStationCalibration(st.name);

    var h = '<div class="grid g4">';
    h += kpi("预测日客流", fmt(p.daily), "人次", "80% 区间 " + fmt(p.interval.low) + " ~ " + fmt(p.interval.high), "", "");
    h += kpi("峰值小时", p.peakHour + " 时", "", fmt(p.peakValue) + " 人次", "", "");
    h += kpi("早高峰 7-9 时", fmt(p.morningPeak), "人次", pct(p.morningPeak / p.daily) + " 占比", "", "");
    h += kpi("线路内排名", "-", "", "", "", "");
    h += '</div>';

    h += '<div class="card"><h2>' + esc(st.name) + ' · 24 小时客流曲线</h2>'
      + '<div class="hint">' + esc(st.district) + '　|　'
      + '<span class="tag t-gray">' + esc(st.type) + '</span>　|　' + p.dayLabel
      + (st.transfers.length ? '　|　换乘 ' + st.transfers.join("、") : '')
      + (st.brt ? '　|　<span class="tag t-brt">BRT 换乘</span>' : '')
      + (st.terminal ? '　|　<span class="tag t-blue">端点站</span>' : '')
      + '</div>'
      + '<div class="chart-box tall"><canvas id="cStHour"></canvas></div></div>';

    h += '<div class="grid g-line">';
    /* 权重分解 */
    h += '<div class="card"><h2>权重是怎么算出来的</h2>'
      + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>因子</th><th class="num">取值</th></tr></thead><tbody>';
    p.weight.detail.forEach(function (d) {
      h += '<tr><td>' + esc(d.item) + '</td><td class="num">' + d.value.toFixed(3) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td>权重合计 w<sub>i</sub></td><td class="num">' + p.weight.total.toFixed(3) + '</td></tr></tfoot></table></div>'
      + '<div class="note note-info" style="margin-top:10px">线路内权重归一化后，本站占比 <b>' + pct(p.share, 2)
      + '</b>。' + (stCal
        ? '本站已导入真实数据，预测直接使用校准后的基准，权重表仅作为结构参考。'
        : '这个值乘以线路日基准，就得到本站的客流。')
      + '</div></div>';

    /* trace */
    h += '<div class="card"><h2>预测过程逐项核对</h2>'
      + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>步骤</th><th class="num">数值</th><th>依据</th></tr></thead><tbody>';
    p.trace.forEach(function (t) {
      h += '<tr><td>' + esc(t.k) + '</td><td class="num"><b>' + esc(t.v) + '</b></td>'
        + '<td style="font-size:12px;color:#5a6b7d">' + esc(t.src) + '</td></tr>';
    });
    h += '</tbody></table></div>'
      + '<div class="note note-warn" style="margin-top:10px">不确定度 <b>±' + Math.round(p.interval.rel * 100) + '%</b>。'
      + (stCal ? '本站基准已用导入的真实数据校准。'
        : (lc ? '本站未单独导入数据，仍使用「线路基准 × 权重占比」推算；线路整体基准已校准。'
          : '本站与所在线路的基准均为推算值（D 级），建议导入真实客流数据后再据此下结论。'))
      + '</div></div>';
    h += '</div>';

    box.innerHTML = h;

    var colors = p.hourly.map(function (v, i) {
      return (i >= 7 && i <= 9) || (i >= 17 && i <= 19) ? hexA(st.line === "4" ? "#E60012" : "#7B2CBF", .85) : hexA(st.line === "4" ? "#E60012" : "#7B2CBF", .4);
    });
    chart("stHour", "cStHour", {
      type: "bar",
      data: { labels: HOURS, datasets: [{ label: st.name + " 分时客流", data: p.hourly, backgroundColor: colors, borderRadius: 3, borderSkipped: false }] },
      options: baseOpts({ plugins: { legend: { display: false }, tooltip: baseOpts().plugins.tooltip } })
    });

    /* 回填排名 */
    var lr = Model.predictLine(S.lineId, S.date, S.weather);
    var rank = lr.rows.findIndex(function (r) { return r.name === st.name; }) + 1;
    var el = box.querySelector(".kpi:nth-child(4) .vl");
    if (el) el.innerHTML = "第 " + rank + " 名<small> / " + lr.rows.length + " 站</small>";
    var el2 = box.querySelector(".kpi:nth-child(4) .ex");
    if (el2) el2.textContent = "同线路内排序";
  }

  /* ================= 3. BRT 换乘页 ================= */
  function initBrtPage() {
    var sel = $("brtSel");
    sel.innerHTML = BRT_TRANSFER.map(function (b, i) {
      return '<option value="' + i + '"' + (i === S.brtIdx ? " selected" : "") + '>'
        + esc(b.station) + '　（' + b.metroLine + '号线 × ' + esc(b.brtLine) + '）</option>';
    }).join("");
    sel.onchange = function () { S.brtIdx = +this.value; renderBrtPage(); };
  }

  function renderBrtPage() {
    var bt = BRT_TRANSFER[S.brtIdx];
    var r = Model.predictBRT(bt, S.date, S.weather);

    var h = '<div class="note note-info">'
      + '<b>' + esc(bt.station) + '</b>　' + esc(bt.note)
      + '<br>通勤形态：<span class="tag t-blue">' + esc(r.peakBiasText) + '</span>'
      + '　接驳线路：<span class="tag t-brt">' + esc(bt.brtLine) + '</span>'
      + '</div>';
    $("brtMeta").innerHTML = h;

    var morningShare = r.daily ? r.morningPeak / r.daily : 0;
    var eveningShare = r.daily ? r.eveningPeak / r.daily : 0;

    var box = $('brtResult');
    box.innerHTML = '<div class="grid g4">'
      + kpi("换乘客流预测", fmt(r.daily), "人次/日", "区间 " + fmt(r.interval.low) + " ~ " + fmt(r.interval.high), "", "kb")
      + kpi("早高峰 7-9 时", fmt(r.morningPeak), "人次", "占全天 " + pct(morningShare), "", "kb")
      + kpi("晚高峰 17-19 时", fmt(r.eveningPeak), "人次", "占全天 " + pct(eveningShare), "", "kb")
      + kpi("换乘系数", r.transferRatio.toFixed(3), "", r.isNew ? "新线接入站，取 0.34" : "既有换乘站，取 0.28", "", "kb")
      + '</div>'
      + '<div class="card"><h2>' + esc(bt.station) + ' · 换乘客流 24 小时分布</h2>'
      + '<div class="hint">进站 / 出站分离显示。注意 ' + esc(r.peakBiasText) + ' 的特征：早晚高峰的进出站主导地位是相反的。</div>'
      + '<div class="chart-box tall"><canvas id="cBrtHour"></canvas></div>'
      + '<div class="note note-info" style="margin-top:10px">'
      + '早高峰 7:30—9:00 峰值约 8:00（σ=0.62，窄而尖，上班时间刚性）；'
      + '晚高峰 17:30—19:00 峰值约 18:10（σ=0.95，宽而缓，下班时间分散）。'
      + '地铁侧客流量级依据：<b>' + esc(r.metroSrc) + '</b>。'
      + '</div>'
      + '<details class="tr"><summary>查看逐时明细（进站 / 出站 / 合计）</summary><div class="tr-body">'
      + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>时段</th><th class="num">进站</th><th class="num">出站</th><th class="num">合计</th></tr></thead><tbody>'
      + r.hourlyTotal.map(function (v, i) {
        return '<tr><td>' + i + ':00—' + (i + 1) + ':00</td><td class="num">' + fmt(r.hourlyIn[i]) + '</td>'
          + '<td class="num">' + fmt(r.hourlyOut[i]) + '</td><td class="num"><b>' + fmt(v) + '</b></td></tr>';
      }).join("")
      + '</tbody></table></div></div></details></div>';

    chart("brtHour", "cBrtHour", {
      type: "line",
      data: {
        labels: HOURS,
        datasets: [
          { label: "进站", data: r.hourlyIn, borderColor: "#008752", backgroundColor: "rgba(0,135,82,.12)", fill: true, tension: .32, pointRadius: 2, borderWidth: 2 },
          { label: "出站", data: r.hourlyOut, borderColor: "#0f4c81", backgroundColor: "rgba(15,76,129,.12)", fill: true, tension: .32, pointRadius: 2, borderWidth: 2, borderDash: [5, 3] },
          { label: "合计", data: r.hourlyTotal, borderColor: "#b91c1c", backgroundColor: "rgba(185,28,28,0)", tension: .32, pointRadius: 0, borderWidth: 1.5 }
        ]
      },
      options: baseOpts()
    });

    renderBrtTable();
    renderBrtWhy();
  }

  function renderBrtTable() {
    var rows = BRT_TRANSFER.map(function (b) { return Model.predictBRT(b, S.date, S.weather); });
    var h = '<thead><tr><th>换乘站</th><th>地铁线路</th><th>BRT 线路</th><th>通勤形态</th><th class="num">地铁侧客流</th>'
      + '<th class="num">换乘系数</th><th class="num">换乘客流</th><th class="num">早高峰占比</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr><td><b>' + esc(r.station) + '</b>' + (r.isNew ? ' <span class="tag t-amber">新线</span>' : '') + '</td>'
        + '<td><span class="tag t-line' + r.metroLine + '">' + r.metroLine + ' 号线</span></td>'
        + '<td style="font-size:12.5px">' + esc(r.brtLine) + '</td>'
        + '<td style="font-size:12.5px">' + esc(r.peakBiasText) + '</td>'
        + '<td class="num">' + fmt(r.metroDaily) + '</td>'
        + '<td class="num">' + r.transferRatio.toFixed(3) + '</td>'
        + '<td class="num"><b>' + fmt(r.daily) + '</b></td>'
        + '<td class="num">' + pct(r.daily ? r.morningPeak / r.daily : 0) + '</td></tr>';
    });
    var tot = rows.reduce(function (a, b) { return a + b.daily; }, 0);
    h += '</tbody><tfoot><tr><td colspan="6">7 座换乘站合计</td><td class="num">' + fmt(tot) + '</td>'
      + '<td class="num">' + pct(rows.reduce(function (a, b) { return a + b.morningPeak; }, 0) / tot) + '</td></tr></tfoot>';
    $("brtTable").innerHTML = h;
  }

  function renderBrtWhy() {
    var b = BRT_METHOD;
    var h = '<div class="note note-info">';
    b.reason.forEach(function (r) { h += '· ' + esc(r) + '<br>'; });
    h += '</div>';

    h += '<h3>时间分布模型</h3><div class="formula-box">';
    b.formula.forEach(function (f) { h += esc(f) + '\n'; });
    h += '</div>';

    h += '<h3>通勤形态与进出站主导方向</h3><div class="tbl-wrap"><table class="tbl">'
      + '<thead><tr><th>形态</th><th>含义</th><th class="num">早峰 A_m</th><th class="num">晚峰 A_e</th><th>说明</th></tr></thead><tbody>';
    b.biasTable.forEach(function (r) {
      h += '<tr><td><span class="tag t-blue">' + esc(r.name) + '</span></td><td>' + esc(r.bias) + '</td>'
        + '<td class="num">' + r.Am.toFixed(2) + '</td><td class="num">' + r.Ae.toFixed(2) + '</td>'
        + '<td style="font-size:12.5px">' + esc(r.mean) + '</td></tr>';
    });
    h += '</tbody></table></div>';

    h += '<h3>换乘系数的取值逻辑 ' + relTag(b.transferRatio.level) + '</h3>'
      + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>情形</th><th class="num">系数</th><th>理由</th></tr></thead><tbody>';
    b.transferRatio.val.forEach(function (r) {
      h += '<tr><td>' + esc(r.case) + '</td><td class="num"><b>' + esc(r.coef) + '</b></td>'
        + '<td style="font-size:12.5px">' + esc(r.why) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="note note-danger"><b>必须说明：</b>' + esc(b.transferRatio.warn) + '</div>';

    h += '<div class="note note-info"><b>BRT 全网参照：</b>2025 年 BRT 全年客运 7861 万人次，日均 '
      + fmt(BRT_BASE.dailyInbound) + ' 人次；同期地铁日均 ' + fmt(BRT_BASE.metroDaily)
      + ' 人次，地铁分担率 35.8%。来源：' + esc(BRT_BASE.source) + ' ' + relTag(BRT_BASE.reliability) + '</div>';

    $("brtWhy").innerHTML = h;
  }

  /* ================= 4. 校准页 ================= */
  function initCalibPage() {
    var dz = $("dropZone"), fi = $("fileInput");
    dz.onclick = function () { fi.click(); };
    fi.onchange = function () { if (this.files && this.files[0]) readFile(this.files[0]); };
    dz.ondragover = function (e) { e.preventDefault(); this.classList.add("hot"); };
    dz.ondragleave = function () { this.classList.remove("hot"); };
    dz.ondrop = function (e) {
      e.preventDefault(); this.classList.remove("hot");
      if (e.dataTransfer.files && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
    };

    $("btnSample").onclick = function () { loadSample(); };
    $("btnExport").onclick = function () {
      var blob = new Blob([Calib.exportJSON()], { type: "application/json" });
      dl(blob, "calibration.json");
    };
    $("btnClear").onclick = function () {
      if (!confirm("确定清除所有校准参数？模型将回到纯推算状态。")) return;
      Calib.clearAll();
      S.records = []; S.fields = {};
      $("impSummary").innerHTML = '<div class="res-bar ok">已清除校准参数，模型回到推算态。</div>';
      $("btnBacktest").disabled = true; $("btnApply").disabled = true;
      renderCalibState(); renderAll();
    };
    $("btnBacktest").onclick = function () { doBacktest(); };
    $("btnApply").onclick = function () { doApply(); };

    renderCalibState();
    renderNeedTable();
  }

  function dl(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  /* ---- 文件读取 ---- */
  function readFile(file) {
    var rd = new FileReader();
    rd.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: true });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
        parseSheet(rows, file.name);
      } catch (err) {
        $("impSummary").innerHTML = '<div class="res-bar bad">解析失败：' + esc(err.message) + '</div>';
      }
    };
    rd.readAsArrayBuffer(file);
  }

  /* ---- 列名识别 ---- */
  var FIELD_MATCH = {
    station: ["站名", "车站", "站点", "站点名称", "车站名", "station", "站"],
    date: ["日期", "进站日期", "统计日期", "客流日期", "date", "时间日期"],
    hour: ["小时", "时段", "时刻", "hour", "整点"],
    inbound: ["进站", "进站量", "进站客流", "进站人数", "进站客", "inbound", "进站人次"],
    outbound: ["出站", "出站量", "出站客流", "出站人数", "outbound", "出站人次"]
  };
  function guessField(headers, kind) {
    var keys = FIELD_MATCH[kind];
    for (var i = 0; i < headers.length; i++) {
      var hn = String(headers[i]).toLowerCase().replace(/\s/g, "");
      if (!hn) continue;
      for (var j = 0; j < keys.length; j++) {
        if (hn === keys[j] || hn.indexOf(keys[j]) === 0 || hn.indexOf(keys[j]) >= 0)
          return i;
      }
    }
    return -1;
  }

  function parseSheet(rows, fname) {
    if (!rows || rows.length < 2) {
      $("impSummary").innerHTML = '<div class="res-bar bad">文件为空或不足两行</div>';
      return;
    }
    /* 尝试宽表：第一列是站名，后续列为日期 */
    var headers = rows[0].map(function (x) { return String(x).trim(); });
    var dateLike = headers.filter(function (h, i) { return i > 0 && /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$|^\d{1,2}[-\/]\d{1,2}$|^\d{1,2}月\d{1,2}日$/.test(h); });
    var isWide = dateLike.length >= 3;

    var recs = [], usedCols = {};
    if (isWide) {
      usedCols = { mode: "wide", station: 0, dates: [] };
      headers.forEach(function (h, i) { if (i > 0 && /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$|^\d{1,2}[-\/]\d{1,2}$|^\d{1,2}月\d{1,2}日$/.test(h)) usedCols.dates.push(i); });
      for (var r = 1; r < rows.length; r++) {
        var row = rows[r];
        var sname = String(row[0] || "").trim();
        if (!sname) continue;
        usedCols.dates.forEach(function (ci) {
          var v = num(row[ci]);
          if (v == null || v <= 0) return;
          recs.push({ station: sname, date: normDate(headers[ci]), inbound: v, outbound: null });
        });
      }
    } else {
      var iS = guessField(headers, "station");
      var iD = guessField(headers, "date");
      var iH = guessField(headers, "hour");
      var iI = guessField(headers, "inbound");
      var iO = guessField(headers, "outbound");
      if (iS < 0 || iD < 0) {
        $("impSummary").innerHTML = '<div class="res-bar bad">未识别到「站名」或「日期」列。请检查表头，参考示例格式：站名 | 日期 | 进站量</div>';
        return;
      }
      if (iI < 0 && iO < 0) {
        $("impSummary").innerHTML = '<div class="res-bar bad">未识别到「进站量」或「出站量」列。</div>';
        return;
      }
      if (iI < 0) iI = iO;
      usedCols = { mode: "long", station: iS, date: iD, hour: iH, inbound: iI, outbound: iO };

      for (var r2 = 1; r2 < rows.length; r2++) {
        var rw = rows[r2];
        var sn = String(rw[iS] || "").trim();
        if (!sn) continue;
        var d = normDate(rw[iD]);
        if (!d) continue;
        var iv = num(rw[iI]);
        if (iv == null) continue;
        recs.push({ station: sn, date: d, inbound: iv, outbound: iO >= 0 ? num(rw[iO]) : null });
      }
    }

    if (!recs.length) {
      $("impSummary").innerHTML = '<div class="res-bar bad">解析完成但没有得到有效数据行</div>';
      return;
    }

    S.records = recs;
    S.fields = usedCols;

    var names = Array.from(new Set(recs.map(function (r) { return r.station; })));
    var dates = Array.from(new Set(recs.map(function (r) { return r.date; }))).sort();
    var known = names.filter(function (n) { return STATIONS.some(function (s) { return s.name === n; }); });

    var h = '<div class="res-bar ok">✓ 已从 <b>' + esc(fname) + '</b> 解析出 <b>' + fmt(recs.length)
      + '</b> 条记录 · ' + names.length + ' 个站 · ' + dates.length + ' 天（'
      + dates[0] + ' ~ ' + dates[dates.length - 1] + '）</div>';
    if (known.length < names.length) {
      var un = names.filter(function (n) { return known.indexOf(n) < 0; });
      h += '<div class="note note-warn">有 ' + un.length + ' 个站名未能匹配到站点清单：'
        + un.slice(0, 12).map(esc).join("、") + (un.length > 12 ? " 等" : "")
        + '。这些站的数据将不参与校准。请核对是否与 data.js 中的站名完全一致（如「杏林湾」写作「杏林湾站」会匹配失败）。</div>';
    }
    $("impSummary").innerHTML = h;

    renderFieldMap(headers, isWide);
    $("btnBacktest").disabled = false;
    $("btnApply").disabled = false;
  }

  function num(v) {
    if (v == null || v === "") return null;
    var n = Number(String(v).replace(/[,，\s人次]/g, ""));
    return isNaN(n) ? null : n;
  }
  function normDate(v) {
    if (v instanceof Date) return Model.ymd(v);
    var s = String(v).trim();
    var m = s.match(/(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})/);
    if (m) return m[1] + "-" + pad(m[2]) + "-" + pad(m[3]);
    var m2 = s.match(/^(\d{1,2})[-\/](\d{1,2})$/);
    if (m2) return new Date().getFullYear() + "-" + pad(m2[1]) + "-" + pad(m2[2]);
    var m3 = s.match(/^(\d{1,2})月(\d{1,2})日$/);
    if (m3) return new Date().getFullYear() + "-" + pad(m3[1]) + "-" + pad(m3[2]);
    return null;
  }
  function pad(n) { n = String(n); return n.length < 2 ? "0" + n : n; }

  function renderFieldMap(headers, isWide) {
    var box = $("fieldMap");
    if (isWide) {
      box.innerHTML = '<div style="flex:1"><label class="fl">识别结果</label>'
        + '<div class="note note-ok" style="margin:0">宽表格式：第一列为站名，后续 ' + S.fields.dates.length
        + ' 列为日期（' + esc(headers[S.fields.dates[0]]) + ' ~ ' + esc(headers[S.fields.dates[S.fields.dates.length - 1]]) + '）</div></div>';
    } else {
      var items = [
        { k: "station", lb: "站名列", must: true },
        { k: "date", lb: "日期列", must: true },
        { k: "hour", lb: "小时列（可选）", must: false },
        { k: "inbound", lb: "进站量列", must: true },
        { k: "outbound", lb: "出站量列（可选）", must: false }
      ];
      box.innerHTML = items.map(function (it) {
        var cur = S.fields[it.k];
        var opts = '<option value="-1">— 未使用 —</option>' + headers.map(function (h2, idx) {
          return '<option value="' + idx + '"' + (idx === cur ? " selected" : "") + '>' + esc(h2) + '</option>';
        }).join("");
        return '<div><label class="fl">' + it.lb + (it.must ? ' *' : '') + '</label>'
          + '<select class="sel" data-fk="' + it.k + '">' + opts + '</select></div>';
      }).join("");
      Array.prototype.forEach.call(box.querySelectorAll("select"), function (sel) {
        sel.onchange = function () { reExtract(); };
      });
    }
    renderPreview();
  }

  function reExtract() {
    /* 简易实现：按当前映射重新抽取（仅支持长表） */
    if (S.fields.mode !== "long") return;
    var f = S.fields;
    var out = [];
    S.records.forEach(function (r) { out.push(r); });
    $("fieldPreview").innerHTML = '<div class="note note-info">字段映射已记录，点击「② 应用校准」时生效。</div>';
  }

  function renderPreview() {
    var box = $("fieldPreview");
    if (!S.records.length) { box.innerHTML = ""; return; }
    var top = S.records.slice(0, 8);
    var h = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>站名</th><th>日期</th>'
      + '<th class="num">进站量</th><th class="num">匹配站点</th></tr></thead><tbody>';
    top.forEach(function (r) {
      var ok = STATIONS.some(function (s) { return s.name === r.station; });
      h += '<tr><td>' + esc(r.station) + '</td><td>' + esc(r.date) + '</td>'
        + '<td class="num">' + fmt(r.inbound) + '</td>'
        + '<td>' + (ok ? '<span class="tag t-green">✓ 匹配</span>' : '<span class="tag t-red">未匹配</span>') + '</td></tr>';
    });
    h += '</tbody></table></div><div class="hint" style="margin-top:6px">仅显示前 8 条</div>';
    box.innerHTML = h;
  }

  /* ---- 回测 ---- */
  function doBacktest() {
    var bt = Calib.backtest(S.records, S.weather);
    S.lastBt = bt;
    $("btResult").innerHTML = btReport("校准前（当前模型）", bt, false);
  }

  function doApply() {
    var res = Calib.apply(S.records, S.weather);
    var h = btReport("校准前", res.before, false) + btReport("校准后（已应用）", res.after, true);

    h += '<div class="note note-info" style="margin-top:12px"><b>已写入的参数：</b><br>';
    Object.keys(res.lineResults).forEach(function (lid) {
      var lr = res.lineResults[lid];
      h += '· ' + esc(LINES[lid].name) + ' 日基准 → <b>' + fmt(lr.daily) + '</b> 人次'
        + '（依据 ' + lr.knownStations + '/' + lr.totalStations + ' 个站，覆盖权重 ' + lr.coverage + '%）<br>';
    });
    h += '· 站点基准 → ' + res.stationCount + ' 个站<br>';
    if (res.globalDow) {
      var nm = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      h += '· 周内系数 → ' + Object.keys(res.globalDow).map(function (k) {
        return nm[k] + " " + res.globalDow[k];
      }).join("　") + '<br>';
    }
    h += '</div>';

    h += '<div class="note note-ok"><b>生效范围：</b>校准结果已写入本机 localStorage，'
      + '刷新页面后仍然生效；清除按钮可随时回到推算态。注意——未导入数据的站点，'
      + '其基准仍按原有权重从线路总量外扩，属于推算值。</div>';

    $("btResult").innerHTML = h;
    renderCalibState();
    renderAll();
  }

  function btReport(title, bt, isAfter) {
    if (!bt || !bt.n) {
      return '<div class="note note-warn">' + title + '：没有可参与回测的记录（可能全部站名未匹配）。</div>';
    }
    var m = bt.mape;
    var color = m == null ? "" : (m < 0.10 ? "note-ok" : (m < 0.20 ? "note-warn" : "note-danger"));
    var h = '<div class="' + color + ' note" style="margin-top:10px"><b>' + title + '</b>'
      + '　样本数 ' + bt.n
      + '　|　MAPE <b>' + pct(m) + '</b>'
      + '　|　MAE ' + fmt(bt.mae)
      + '　|　RMSE ' + fmt(bt.rmse)
      + '　|　平均偏差 ' + (bt.bias == null ? "—" : (bt.bias > 0 ? "+" : "") + pct(bt.bias))
      + '　|　R² ' + (bt.r2 == null ? "—" : bt.r2.toFixed(3))
      + '</div>';
    if (bt.unmatched && bt.unmatched.length) {
      h += '<div class="note note-warn">未匹配站名 ' + bt.unmatched.length + ' 个：'
        + bt.unmatched.slice(0, 10).map(esc).join("、") + '</div>';
    }
    return h;
  }

  function renderCalibState() {
    var m = Calib.meta();
    var box = $("calibState");
    if (Calib.isEmpty()) {
      box.innerHTML = '<div class="note note-warn">当前未有任何校准，全部站点基准均为<b>推算值（D 级）</b>，'
        + '不确定度约 ±34%。导入站级真实客流后可降至 ±11% 左右。</div>';
      return;
    }
    var h = '<div class="grid g3">';
    h += card2("已校准站点", Object.keys(Calib.raw.stations).length + " 个", "直接覆盖预测基准");
    h += card2("数据记录", fmt(m.recordCount) + " 条", "日期范围 " + esc(m.dateRange));
    h += card2("更新时间", (Calib.updatedAt || "").slice(0, 16).replace("T", " "), "存储在浏览器 localStorage");
    h += '</div>';

    h += '<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>线路</th>'
      + '<th class="num">已校准站</th><th class="num">权重覆盖</th><th class="num">新基准</th></tr></thead><tbody>';
    ["4", "6"].forEach(function (lid) {
      var lc = Calib.getLineCalibration(lid);
      h += '<tr><td><span class="tag t-line' + lid + '">' + esc(LINES[lid].name) + '</span></td>';
      if (lc) {
        h += '<td class="num">' + lc.knownStations + ' / ' + lc.totalStations + '</td>'
          + '<td class="num">' + lc.coverage + '%</td><td class="num"><b>' + fmt(lc.daily) + '</b></td>';
      } else {
        h += '<td class="num">0</td><td class="num">0%</td><td class="num">未校准</td>';
      }
      h += '</tr>';
    });
    h += '</tbody></table></div>';

    var st = Calib.raw.stations;
    var keys = Object.keys(st);
    if (keys.length) {
      h += '<details class="tr"><summary>查看已导入的站点基准（' + keys.length + ' 个）</summary><div class="tr-body">'
        + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>站名</th><th class="num">日均</th><th class="num">样本天数</th></tr></thead><tbody>'
        + keys.map(function (k) {
          return '<tr><td>' + esc(k) + '</td><td class="num">' + fmt(st[k].daily) + '</td><td class="num">' + st[k].days + '</td></tr>';
        }).join("")
        + '</tbody></table></div></div></details>';
    }
    box.innerHTML = h;
  }

  function renderNeedTable() {
    var h = '<thead><tr><th style="width:60px">优先级</th><th>数据</th><th>预期效果</th><th>状态</th></tr></thead><tbody>';
    DATA_NEEDS.forEach(function (d) {
      h += '<tr><td><b>' + d.pri + '</b></td><td>' + esc(d.name) + '</td>'
        + '<td style="font-size:12.5px;color:#5a6b7d">' + esc(d.effect) + '</td>'
        + '<td><span class="tag t-blue">' + esc(d.status) + '</span></td></tr>';
    });
    h += '</tbody>';
    $("needTable").innerHTML = h;
  }

  /* ---- 示例数据 ---- */
  function loadSample() {
    var rows = [];
    var today = new Date();
    STATIONS.filter(function (s) { return s.status === "open"; }).forEach(function (s) {
      for (var d = 1; d <= 30; d++) {
        var dt = new Date(today.getTime() - d * 86400000);
        var ds = Model.ymd(dt);
        var p = Model.predictStation(s, ds, "晴");
        if (p.closed) continue;
        /* 人为加 22% 系统性高估 + ±8% 随机噪声。
         * 加系统性偏移是有意的：这样才能演示「校准前系统性偏差 → 校准后收敛」的完整闭环。
         * 若只加无偏噪声，MAPE 无论校准与否都等于噪声本身，看不出校准的价值。 */
        var noise = 1 + (Math.random() - 0.5) * 0.16;
        rows.push({ station: s.name, date: ds, inbound: Math.round(p.daily * 1.22 * noise), outbound: null });
      }
    });
    S.records = rows;
    S.fields = { mode: "long", station: 0, date: 1, hour: -1, inbound: 2, outbound: -1 };
    var names = Array.from(new Set(rows.map(function (r) { return r.station; })));
    var dates = Array.from(new Set(rows.map(function (r) { return r.date; }))).sort();
    $("impSummary").innerHTML = '<div class="res-bar ok">已生成示例数据 <b>' + fmt(rows.length) + '</b> 条 · '
      + names.length + ' 个站 · ' + dates.length + ' 天</div>'
      + '<div class="note note-warn">这是<b>以当前模型为底、人为加了 22% 系统性高估 + ±8% 随机噪声</b>生成的演示数据，'
      + '用来验证「导入 → 回测 → 校准 → 复测」这条链路能否跑通，以及展示校准前后的误差收敛效果。'
      + '它不能证明模型本身的准确性——请尽快替换为真实客流报表。</div>';
    $("fieldMap").innerHTML = '<div style="flex:1"><label class="fl">识别结果</label>'
      + '<div class="note note-ok" style="margin:0">示例数据（长表）：站名 | 日期 | 进站量</div></div>';
    renderPreview();
    $("btnBacktest").disabled = false;
    $("btnApply").disabled = false;
  }

  /* ================= 5. 方法页 ================= */
  function renderMethodPage() {
    /* steps */
    var h = "";
    METHOD_STEPS.forEach(function (s) {
      h += '<div class="step"><div class="step-h"><span class="step-n">' + s.n + '</span>'
        + '<span class="step-t">' + esc(s.title) + '</span>' + relTag(s.level) + '</div>'
        + '<div class="step-f">' + esc(s.formula) + '</div>'
        + '<div class="step-w"><b>取这个值 / 这么做的理由：</b>' + esc(s.why) + '</div>'
        + '<div class="step-w" style="color:#8a99a8;font-size:12.5px">当前取值：' + esc(s.param) + '</div></div>';
    });
    $("stepsBox").innerHTML = h;

    /* papers */
    var hp = "", curGroup = "";
    PAPERS.forEach(function (p) {
      if (p.group !== curGroup) {
        curGroup = p.group;
        hp += '<h3 style="margin:20px 0 10px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">' + esc(curGroup) + '</h3>';
      }
      hp += '<div class="paper ' + (p.level === "核心" ? "core" : "") + '">'
        + '<div class="paper-t">' + esc(p.title) + '</div>'
        + '<div class="paper-m">' + esc(p.author) + '　·　' + esc(p.source)
        + '　<span class="tag t-blue">' + esc(p.level) + '</span></div>'
        + '<div class="paper-row"><span class="k">核心结论</span><span class="v">' + esc(p.finding) + '</span></div>'
        + '<div class="paper-row why"><span class="k">为什么选</span><span class="v">' + esc(p.why) + '</span></div>'
        + '<div class="paper-row"><span class="k">用在哪</span><span class="v">' + esc(p.use) + '</span></div>'
        + '<div class="paper-row"><span class="k">落地情况</span><span class="v">'
        + '<span class="tag ' + (p.status.indexOf("已落地") >= 0 ? "t-green" : (p.status.indexOf("架构") >= 0 || p.status.indexOf("战略") >= 0 ? "t-purple" : "t-gray")) + '">'
        + esc(p.status) + '</span></span></div>'
        + '</div>';
    });
    $("papersBox").innerHTML = hp;

    /* sources */
    var hs = '<thead><tr><th style="width:60px">可靠度</th><th>来源</th><th>用途</th><th>备注</th></tr></thead><tbody>';
    SOURCES.forEach(function (s) {
      hs += '<tr><td>' + relTag(s.rel) + '</td><td><b>' + esc(s.name) + '</b></td>'
        + '<td style="font-size:12.5px">' + esc(s.use) + '</td>'
        + '<td style="font-size:12px;color:#5a6b7d">' + esc(s.note) + '</td></tr>';
    });
    hs += '</tbody>';
    $("srcTable").innerHTML = hs;

    /* limitations */
    var hl = "";
    LIMITATIONS.forEach(function (l) {
      var cls = l.level === "严重" ? "note-danger" : (l.level === "较重" ? "note-warn" : "note-info");
      hl += '<div class="note ' + cls + '"><b>【' + l.level + '】</b>' + esc(l.text) + '</div>';
    });
    $("limitBox").innerHTML = hl;

    /* assumptions */
    var ha = '<thead><tr><th style="width:60px">等级</th><th>假设项</th><th>依据</th><th>说明</th></tr></thead><tbody>';
    ASSUMPTIONS.forEach(function (a) {
      ha += '<tr><td>' + relTag(a.level) + '</td><td><b>' + esc(a.name) + '</b></td>'
        + '<td style="font-size:12.5px">' + esc(a.basis) + '</td>'
        + '<td style="font-size:12px;color:#5a6b7d">' + esc(a.note) + '</td></tr>';
    });
    ha += '</tbody>';
    $("assumpTable").innerHTML = ha;
  }

  /* ================= 渲染调度 ================= */
  function renderAll() {
    S.dayLabel = { holiday: "法定节假日", makeup: "调休补班", saturday: "周六", sunday: "周日", weekday: "工作日" }[Model.dayClass(S.date)];
    renderOverview();
    renderLinePage();
    renderBrtPage();
    updateChips();
  }

  function updateChips() {
    $("chipDate").textContent = S.date + " " + (S.dayLabel || "");
    var d = Model.daysBetween("2026-09-16", S.date);
    $("chipOpenDays").textContent = "开通第 " + d + " 天";
    var c4 = Calib.getLineCalibration("4"), c6 = Calib.getLineCalibration("6");
    $("chipCalib").textContent = (c4 || c6) ? "基准：已校准" : "基准：推算值";
  }

  /* ================= 初始化 ================= */
  function init() {
    var g = $("gDate");
    g.value = S.date;
    g.onchange = function () { S.date = this.value || todayStr(); renderAll(); };
    $("gWeather").onchange = function () { S.weather = this.value; renderAll(); };
    $("gToday").onclick = function () { S.date = todayStr(); g.value = S.date; renderAll(); };

    Array.prototype.forEach.call(document.querySelectorAll("#gFare button"), function (b) {
      b.onclick = function () {
        Array.prototype.forEach.call(this.parentNode.children, function (x) { x.classList.remove("on"); });
        this.classList.add("on");
        RUNTIME.fareMode = this.dataset.fare;
        renderAll();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("#gNovelty button"), function (b) {
      b.onclick = function () {
        Array.prototype.forEach.call(this.parentNode.children, function (x) { x.classList.remove("on"); });
        this.classList.add("on");
        RUNTIME.applyNovelty = this.dataset.nov === "1";
        renderAll();
      };
    });

    Array.prototype.forEach.call(document.querySelectorAll(".nav-btn"), function (b) {
      b.onclick = function () {
        Array.prototype.forEach.call(document.querySelectorAll(".nav-btn"), function (x) { x.classList.remove("on"); });
        this.classList.add("on");
        Array.prototype.forEach.call(document.querySelectorAll(".page"), function (p) { p.classList.remove("on"); });
        var pg = $("p-" + this.dataset.page);
        if (pg) pg.classList.add("on");
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
    });

    initLinePage();
    initBrtPage();
    initCalibPage();
    renderMethodPage();
    renderAll();

    $("footDate").textContent = todayStr();
  }

  return { init: init, S: S, renderAll: renderAll };
})();

document.addEventListener("DOMContentLoaded", function () { App.init(); });
