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
    records: [],        /* 导入的记录 */
    fields: {},         /* 字段映射 */
    fileName: "",       /* 本次导入的文件名，写入学习履历 */
    charts: {}          /* Chart 实例池 */
  };

  function todayStr() { return Model.ymd(new Date()); }
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* 所有客流量一律四舍五入到百位。
   * 模型的误差远大于十位，保留到个位只会给出虚假的精确感；但千位太粗，
   * 分时曲线与中小站点的日客流会被抹成 0，因此统一取百位。 */
  function round100(n) { return Math.round((Number(n) || 0) / 100) * 100; }
  function fmt(n) { return round100(n).toLocaleString("zh-CN"); }
  /* 非客流数值（记录条数、站数、样本天数等）不参与取整 */
  function fmtInt(n) { return Math.round(Number(n) || 0).toLocaleString("zh-CN"); }
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

  /* ================= 1. 总览（只保留主要信息） ================= */
  function renderOverview() {
    var all = Model.predictAll(S.date, S.weather);
    var l4 = all.l4, l6 = all.l6;
    var u = Math.sqrt(Math.pow(0.30, 2) + Math.pow(0.15, 2) + Math.pow(0.06, 2));
    var mPeak = Model.sumRange(all.hourly, 7, 9);
    var ePeak = Model.sumRange(all.hourly, 17, 19);

    $("ovKpi").innerHTML = [
      kpi("4 号线日客流", fmt(l4.total), "人次", l4.openCount + " 座运营站 · 峰值 " + l4.peakHour + " 时", "", "k4"),
      kpi("6 号线日客流", fmt(l6.total), "人次", l6.openCount + " 座运营站 · 峰值 " + l6.peakHour + " 时", "", "k6"),
      kpi("双线合计", fmt(all.total), "人次/日", "口径：两条线进站总量相加", "", ""),
      kpi("早高峰 7—9 时", fmt(mPeak), "人次", "三小时累计 · 占全天 " + pct(all.total ? mPeak / all.total : 0), "", ""),
      kpi("晚高峰 17—19 时", fmt(ePeak), "人次", "三小时累计 · 占全天 " + pct(all.total ? ePeak / all.total : 0), "", ""),
      kpi("全天峰值小时", all.peakHour + " 时", "", fmt(all.hourly[all.peakHour]) + " 人次", "", "")
    ].join("");

    /* 双线 24h 曲线 */
    chart("ovHour", "cOvHour", {
      type: "line",
      data: {
        labels: HOURS,
        datasets: [
          { label: "4 号线", data: l4.hourly.map(round100), borderColor: "#E60012", backgroundColor: "rgba(230,0,18,.14)", fill: true, tension: .35, pointRadius: 2, borderWidth: 2 },
          { label: "6 号线", data: l6.hourly.map(round100), borderColor: "#7B2CBF", backgroundColor: "rgba(123,44,191,.14)", fill: true, tension: .35, pointRadius: 2, borderWidth: 2 }
        ]
      },
      options: baseOpts()
    });

    /* 构成（只含两条轨道线） */
    var sum2 = l4.total + l6.total;
    chart("ovLine", "cOvLine", {
      type: "doughnut",
      data: {
        labels: ["4 号线", "6 号线"],
        datasets: [{ data: [l4.total, l6.total], backgroundColor: ["#E60012", "#7B2CBF"], borderWidth: 2, borderColor: "#fff" }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "58%",
        plugins: {
          legend: { position: "bottom", labels: { color: "#5a6b7d", font: { size: 12 }, boxWidth: 12, usePointStyle: true } },
          tooltip: {
            backgroundColor: "rgba(15,34,51,.94)", padding: 9, cornerRadius: 6,
            callbacks: { label: function (c) { return c.label + "：" + fmt(c.raw) + " 人次（" + (sum2 ? (c.raw / sum2 * 100).toFixed(1) : 0) + "%）"; } }
          }
        }
      }
    });

    /* 站点排行（只含已开通站） */
    var rows = l4.rows.concat(l6.rows).sort(function (a, b) { return b.daily - a.daily; });
    var h = '<thead><tr><th style="width:44px">#</th><th>站名</th><th>线路</th><th>行政区</th><th>站点类型</th><th class="num">日客流</th><th class="num">早高峰 7-9时</th></tr></thead><tbody>';
    rows.forEach(function (r, i) {
      var rc = i < 3 ? " r" + (i + 1) : "";
      h += '<tr><td><span class="rank' + rc + '">' + (i + 1) + '</span></td>'
        + '<td><b>' + esc(r.name) + '</b></td>'
        + '<td><span class="tag t-line' + r.line + '">' + esc(r.lineName) + '</span></td>'
        + '<td>' + esc(r.district) + '</td>'
        + '<td><span class="tag t-gray">' + esc(r.type) + '</span></td>'
        + '<td class="num"><b>' + fmt(r.daily) + '</b></td>'
        + '<td class="num">' + fmt(r.morningPeak) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td colspan="5">合计</td><td class="num">' + fmt(all.total) + '</td><td class="num">' + fmt(mPeak) + '</td></tr></tfoot>';
    $("ovRank").innerHTML = h;

    renderPending();
    renderAnchors();
  }

  /* 未开通站点：只列事实，不给任何数字 */
  function renderPending() {
    var pend = STATIONS.filter(function (s) { return s.status !== "open"; });
    if (!pend.length) { $("ovPending").innerHTML = '<div class="note note-ok">当前线路库内无暂缓开通站点。</div>'; return; }
    var h = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>站名</th><th>线路</th><th>行政区</th><th>状态</th><th>预测处理</th></tr></thead><tbody>';
    pend.forEach(function (s) {
      h += '<tr><td><b>' + esc(s.name) + '</b></td>'
        + '<td><span class="tag t-line' + s.line + '">' + esc(LINES[s.line].name) + '</span></td>'
        + '<td>' + esc(s.district) + '</td>'
        + '<td><span class="tag t-gray">暂缓开通</span></td>'
        + '<td style="font-size:12.5px;color:#5a6b7d">不纳入权重分配，不产生预测值</td></tr>';
    });
    h += '</tbody></table></div>';
    $("ovPending").innerHTML = h;
  }

  function kpi(lb, vl, unit, ex, rg, cls) {
    return '<div class="kpi ' + (cls || "") + '">'
      + '<div class="lb">' + esc(lb) + '</div>'
      + '<div class="vl">' + vl + (unit ? '<small>' + unit + '</small>' : '') + '</div>'
      + (ex ? '<div class="ex">' + ex + '</div>' : '')
      + (rg ? '<div class="rg">' + rg + '</div>' : '')
      + '</div>';
  }

  /* 说明：原「全网参考量级」卡片已移除。
   * 原因是它把老三线估算值拼进 4/6 号线，形成跨口径的加总，
   * 容易让人误以为两条新线已计入官方全网客流——实际上并没有。 */

  function renderAnchors() {
    var h = "";
    ANCHORS.forEach(function (a) {
      h += '<details class="tr"' + (a.date === "2026-09-16" ? " open" : "") + '><summary>'
        + esc(a.date) + ' · ' + esc(a.label) + '　（' + a.metrics.length + ' 项观测）</summary><div class="tr-body">'
        + '<table class="tbl"><thead><tr><th style="width:60px">可靠度</th><th style="width:200px">指标</th><th style="width:130px">数值</th><th>说明</th></tr></thead><tbody>';
      a.metrics.forEach(function (m) {
        h += '<tr><td>' + relTag(m.rel) + '</td>'
          + '<td>' + esc(m.text) + '</td>'
          + '<td class="num">' + (m.value == null ? "—" : fmtInt(m.value) + " " + m.unit) + '</td>'
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
      + '<thead><tr><th>#</th><th>站名</th><th>类型</th><th class="num">日客流</th><th class="num">峰值时</th></tr></thead><tbody>';
    r.rows.forEach(function (s, i) {
      h += '<tr><td><span class="rank' + (i < 3 ? " r" + (i + 1) : "") + '">' + (i + 1) + '</span></td>'
        + '<td><b>' + esc(s.name) + '</b></td><td><span class="tag t-gray">' + esc(s.type) + '</span></td>'
        + '<td class="num"><b>' + fmt(s.daily) + '</b></td><td class="num">' + s.peakHour + ' 时</td></tr>';
    });
    h += '</tbody></table></div></div></div>';

    /* 暂缓站提示 */
    var pend = STATIONS.filter(function (s) { return s.line === S.lineId && s.status === "pending"; });
    if (pend.length) {
      h += '<div class="card"><h2>暂缓开通站点（不出数）</h2>'
        + '<div class="hint">下列站点尚未投入运营，不纳入权重分配，也不提供任何预测值</div>'
        + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>站名</th><th>行政区</th><th>站点类型</th><th>处理方式</th></tr></thead><tbody>';
      pend.forEach(function (s) {
        h += '<tr><td><b>' + esc(s.name) + '</b></td><td>' + esc(s.district) + '</td>'
          + '<td><span class="tag t-gray">' + esc(s.type) + '</span></td>'
          + '<td style="font-size:12.5px;color:#5a6b7d">排除在预测之外 · 不臆测客流</td></tr>';
      });
      h += '</tbody></table></div></div>';
    }

    box.innerHTML = h;

    chart("lnHour", "cLnHour", {
      type: "bar",
      data: {
        labels: HOURS,
        datasets: [{ label: r.lineName + " 分时客流", data: r.hourly.map(round100), backgroundColor: colors, borderRadius: 3, borderSkipped: false }]
      },
      options: baseOpts({ plugins: { legend: { display: false }, tooltip: baseOpts().plugins.tooltip } })
    });

    chart("lnRank", "cLnRank", {
      type: "bar",
      data: {
        labels: r.rows.map(function (s) { return s.name; }),
        datasets: [{ label: "日客流", data: r.rows.map(function (s) { return round100(s.daily); }), backgroundColor: LINES[S.lineId].color, borderRadius: 3 }]
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
        ? '本站已导入实际数据，预测直接使用学到的基准，权重表仅作为结构参考。'
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
      + (stCal ? '本站基准已用导入的实际数据学到。'
        : (lc ? '本站未单独导入数据，仍使用「线路基准 × 权重占比」推算；线路整体基准已学到。'
          : '本站与所在线路的基准均为推算值（D 级），建议导入实际客流数据后再据此下结论。'))
      + '</div></div>';
    h += '</div>';

    box.innerHTML = h;

    var colors = p.hourly.map(function (v, i) {
      return (i >= 7 && i <= 9) || (i >= 17 && i <= 19) ? hexA(st.line === "4" ? "#E60012" : "#7B2CBF", .85) : hexA(st.line === "4" ? "#E60012" : "#7B2CBF", .4);
    });
    chart("stHour", "cStHour", {
      type: "bar",
      data: { labels: HOURS, datasets: [{ label: st.name + " 分时客流", data: p.hourly.map(round100), backgroundColor: colors, borderRadius: 3, borderSkipped: false }] },
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

  /* ================= 3. 实际数据导入 ================= */
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
      dl(blob, "metro-learning-archive.json");
    };

    var ji = $("jsonInput");
    $("btnImport").onclick = function () { ji.click(); };
    ji.onchange = function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function (e) {
        try {
          if (Calib.importJSON(e.target.result)) {
            $("impSummary").innerHTML = '<div class="res-bar ok">✓ 学习档案已并入当前记忆，模型参数已更新。</div>';
            renderCalibState(); renderAll();
          } else {
            $("impSummary").innerHTML = '<div class="res-bar bad">档案格式不正确，缺少 stations 字段。</div>';
          }
        } catch (err) {
          $("impSummary").innerHTML = '<div class="res-bar bad">读取失败：' + esc(err.message) + '</div>';
        }
      };
      rd.readAsText(f);
      this.value = "";
    };

    $("btnClear").onclick = function () {
      if (!confirm("确定清空全部学习档案？模型会回到纯推算状态，累积的数据将无法恢复。建议先点「导出学习档案 JSON」备份。")) return;
      Calib.clearAll();
      S.records = []; S.fields = {};
      $("impSummary").innerHTML = '<div class="res-bar ok">学习档案已清空，模型回到推算态。</div>';
      $("btResult").innerHTML = "";
      $("btnBacktest").disabled = true; $("btnApply").disabled = true;
      renderCalibState(); renderAll();
    };
    $("btnBacktest").onclick = function () { doBacktest(); };
    $("btnApply").onclick = function () { doLearn(); };

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
    S.fileName = fname;

    var names = Array.from(new Set(recs.map(function (r) { return r.station; })));
    var dates = Array.from(new Set(recs.map(function (r) { return r.date; }))).sort();
    var known = names.filter(function (n) { return STATIONS.some(function (s) { return s.name === n; }); });

    var h = '<div class="res-bar ok">✓ 已从 <b>' + esc(fname) + '</b> 解析出 <b>' + fmtInt(recs.length)
      + '</b> 条记录 · ' + names.length + ' 个站 · ' + dates.length + ' 天（'
      + dates[0] + ' ~ ' + dates[dates.length - 1] + '）</div>';
    if (known.length < names.length) {
      var un = names.filter(function (n) { return known.indexOf(n) < 0; });
      h += '<div class="note note-warn">有 ' + un.length + ' 个站名未能匹配到站点清单：'
        + un.slice(0, 12).map(esc).join("、") + (un.length > 12 ? " 等" : "")
        + '。这些站的数据将不参与学习。请核对是否与 data.js 中的站名完全一致（如「杏林湾」写作「杏林湾站」会匹配失败）。</div>';
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
    $("fieldPreview").innerHTML = '<div class="note note-info">字段映射已记录，点击「② 学习并复测」时生效。</div>';
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
    $("btResult").innerHTML = btReport("学习前（当前模型）", bt, false);
  }

  function doLearn() {
    var res = Calib.learn(S.records, S.weather, S.fileName || "手动导入");
    var h = btReport("学习前（上一次的记忆）", res.before, false)
      + btReport("学习后（并入本次数据）", res.after, true);

    /* 收敛判断 */
    if (res.before.mape != null && res.after.mape != null && res.after.n > 0) {
      var delta = res.after.mape - res.before.mape;
      if (delta < -0.002) {
        h += '<div class="note note-ok" style="margin-top:10px"><b>本次学习有效：</b>MAPE 由 '
          + pct(res.before.mape) + ' 降到 ' + pct(res.after.mape)
          + '，改善 ' + pct(Math.abs(delta)) + '。新参数已写入长期记忆，下一次预测会自动沿用。</div>';
      } else if (delta > 0.002) {
        h += '<div class="note note-warn" style="margin-top:10px"><b>本次学习反而变差：</b>MAPE 由 '
          + pct(res.before.mape) + ' 升到 ' + pct(res.after.mape) + '。'
          + '常见原因：这批数据的时段与之前差异过大（例如跨了节假日），或含未开通站/异常值。'
          + '参数仍然写入了记忆，但建议核对数据质量，必要时清空后重新导入。</div>';
      } else {
        h += '<div class="note note-info" style="margin-top:10px">本次 MAPE 基本持平（'
          + pct(res.before.mape) + ' → ' + pct(res.after.mape) + '）。'
          + '这说明这批数据与之前学到的规律一致，参数被小幅微调。</div>';
      }
    }

    h += '<div class="note note-info" style="margin-top:12px"><b>本次写入长期记忆的内容：</b><br>';
    Object.keys(res.lineResults).forEach(function (lid) {
      var lr = res.lineResults[lid];
      h += '· ' + esc(LINES[lid].name) + ' 日基准 → <b>' + fmt(lr.daily) + '</b> 人次'
        + '（依据 ' + lr.knownStations + '/' + lr.totalStations + ' 个站，覆盖权重 ' + lr.coverage + '%）<br>';
    });
    h += '· 站点基准 → 本次更新 ' + res.stationCount + ' 个站，新增 ' + fmtInt(res.added) + ' 条日记录<br>';
    if (res.globalDow) {
      var nm = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      h += '· 周内系数 → ' + Object.keys(res.globalDow).map(function (k) {
        return nm[k] + " " + res.globalDow[k];
      }).join("　") + '<br>';
    }
    h += '</div>';

    h += '<div class="note note-ok"><b>长期记忆：</b>台账已写入本机 localStorage，'
      + '同一天的记录以最新导入为准，不会重复计数。多次导入会叠加，样本越多，基准越稳。'
      + '关闭浏览器、重启电脑后依然生效；换设备时用「导出学习档案」迁移。</div>';

    $("btResult").innerHTML = h;
    renderCalibState();
    renderAll();
  }

  /* 兼容旧入口名 */
  function doApply() { doLearn(); }

  function btReport(title, bt, isAfter) {
    if (!bt || !bt.n) {
      return '<div class="note note-warn">' + title + '：没有可参与回测的记录（可能全部站名未匹配）。</div>';
    }
    var m = bt.mape;
    var color = m == null ? "" : (m < 0.10 ? "note-ok" : (m < 0.20 ? "note-warn" : "note-danger"));
    var h = '<div class="' + color + ' note" style="margin-top:10px"><b>' + title + '</b>'
      + '　样本数 ' + fmtInt(bt.n)
      + '　|　MAPE <b>' + pct(m) + '</b>'
      + '　|　MAE ' + fmtInt(bt.mae)
      + '　|　RMSE ' + fmtInt(bt.rmse)
      + '　|　平均偏差 ' + (bt.bias == null ? "—" : (bt.bias > 0 ? "+" : "") + pct(bt.bias))
      + '　|　R² ' + (bt.r2 == null ? "—" : bt.r2.toFixed(3))
      + '</div>';
    if (bt.unmatched && bt.unmatched.length) {
      h += '<div class="note note-warn">未匹配站名 ' + bt.unmatched.length + ' 个：'
        + bt.unmatched.slice(0, 10).map(esc).join("、") + '</div>';
    }
    if (bt.pendingNamed && bt.pendingNamed.length) {
      h += '<div class="note note-warn">下列站点<b>尚未开通</b>，其数据不参与学习与回测：'
        + bt.pendingNamed.map(esc).join("、") + '。若这些站已经开通，请更新 <code>data.js</code> 中的状态。</div>';
    }
    return h;
  }

  function renderCalibState() {
    var m = Calib.meta();
    var box = $("calibState");

    if (Calib.isEmpty()) {
      box.innerHTML = '<div class="note note-warn"><b>学习档案为空。</b>当前所有站点基准均为<b>推算值（D 级）</b>，'
        + '不确定度约 ±34%。导入站级实际客流后，会降至 ±11% 左右。<br>'
        + '档案存放在本机浏览器，关掉浏览器不会丢。</div>';
      return;
    }

    var hist = Calib.history();
    var h = '<div class="grid g4">';
    h += card2("累计学习次数", fmtInt(hist.length) + " 次", "每次导入记一次");
    h += card2("累计日记录", fmtInt(Calib.totalRecords()) + " 条", "同日期自动去重");
    h += card2("覆盖站点", fmtInt(Calib.stationCount()) + " 个", "已写入基准");
    h += card2("数据跨度", esc(m.dateRange || "—"), "首末日期");
    h += '</div>';

    /* 最近一次学习的收敛情况 */
    if (hist.length) {
      var last = hist[hist.length - 1];
      var ok = last.beforeMape != null && last.afterMape != null && last.afterMape < last.beforeMape;
      h += '<div class="note ' + (ok ? "note-ok" : "note-info") + '" style="margin-top:12px">'
        + '<b>最近一次学习</b>（' + esc((last.at || "").slice(0, 16).replace("T", " ")) + '，' + esc(last.file) + '）：'
        + 'MAPE ' + pct(last.beforeMape) + ' → <b>' + pct(last.afterMape) + '</b>'
        + '，样本 ' + fmtInt(last.n) + ' 条，新增 ' + fmtInt(last.added) + ' 条日记录。</div>';
    } else {
      h += '<div class="note note-info" style="margin-top:12px">当前参数由旧版档案迁移而来，尚无新的学习记录。</div>';
    }

    /* 学习曲线 */
    var plotted = hist.filter(function (x) { return x.afterMape != null; });
    if (plotted.length >= 2) {
      h += '<div class="card" style="margin-top:14px"><h2>误差随学习次数的变化</h2>'
        + '<div class="hint">横轴是第几次导入，纵轴是同一批数据学习前后的 MAPE。曲线走低说明模型在累积经验。</div>'
        + '<div class="chart-box"><canvas id="cLearn"></canvas></div></div>';
    }

    /* 线路状态 */
    h += '<div class="tbl-wrap" style="margin-top:14px"><table class="tbl"><thead><tr><th>线路</th>'
      + '<th class="num">已学站</th><th class="num">权重覆盖</th><th class="num">线路日基准</th></tr></thead><tbody>';
    ["4", "6"].forEach(function (lid) {
      var lc = Calib.getLineCalibration(lid);
      h += '<tr><td><span class="tag t-line' + lid + '">' + esc(LINES[lid].name) + '</span></td>';
      if (lc) {
        h += '<td class="num">' + lc.knownStations + ' / ' + lc.totalStations + '</td>'
          + '<td class="num">' + lc.coverage + '%</td><td class="num"><b>' + fmt(lc.daily) + '</b></td>';
      } else {
        h += '<td class="num">0</td><td class="num">0%</td><td class="num">未学习</td>';
      }
      h += '</tr>';
    });
    h += '</tbody></table></div>';

    /* 周内系数 */
    if (Calib.raw.globalDow) {
      var nm = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      h += '<div class="note note-info" style="margin-top:12px"><b>已学到的周内系数：</b>'
        + Object.keys(Calib.raw.globalDow).map(function (k) {
          return nm[k] + " <b>" + Calib.raw.globalDow[k] + "</b>";
        }).join("　") + '</div>';
    }

    /* 站点台账 */
    var st = Calib.raw.stations;
    var keys = Object.keys(st).sort();
    if (keys.length) {
      h += '<details class="tr"><summary>查看已学到的站点基准（' + keys.length + ' 个）</summary><div class="tr-body">'
        + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>站名</th><th class="num">稳定期基准</th>'
        + '<th class="num">样本天数</th><th>数据区间</th></tr></thead><tbody>'
        + keys.map(function (k) {
          var r = st[k];
          return '<tr><td>' + esc(k) + '</td><td class="num"><b>' + fmt(r.daily) + '</b></td>'
            + '<td class="num">' + fmtInt(r.days) + '</td>'
            + '<td style="font-size:12px;color:#8a99a8">' + esc((r.firstAt || "—") + " ~ " + (r.lastAt || "—")) + '</td></tr>';
        }).join("")
        + '</tbody></table></div></div></details>';
    }

    /* 学习履历 */
    if (hist.length) {
      h += '<details class="tr"' + (hist.length ? " open" : "") + '><summary>学习履历（' + hist.length + ' 次）</summary><div class="tr-body">'
        + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>时间</th><th>来源</th>'
        + '<th class="num">记录数</th><th class="num">新增</th><th>数据区间</th>'
        + '<th class="num">学习前 MAPE</th><th class="num">学习后 MAPE</th></tr></thead><tbody>';
      hist.forEach(function (x, i) {
        h += '<tr><td>' + (i + 1) + '</td>'
          + '<td style="font-size:12.5px">' + esc((x.at || "").slice(0, 16).replace("T", " ")) + '</td>'
          + '<td style="font-size:12.5px">' + esc(x.file || "—") + '</td>'
          + '<td class="num">' + fmtInt(x.records) + '</td>'
          + '<td class="num">' + fmtInt(x.added) + '</td>'
          + '<td style="font-size:12px;color:#8a99a8">' + esc((x.dateFrom || "—") + " ~ " + (x.dateTo || "—")) + '</td>'
          + '<td class="num">' + pct(x.beforeMape) + '</td>'
          + '<td class="num"><b>' + pct(x.afterMape) + '</b></td></tr>';
      });
      h += '</tbody></table></div></div></details>';
    }

    box.innerHTML = h;

    if (plotted.length >= 2) {
      chart("learn", "cLearn", {
        type: "line",
        data: {
          labels: plotted.map(function (_, i) { return "第 " + (i + 1) + " 次"; }),
          datasets: [
            {
              label: "学习前 MAPE", data: plotted.map(function (x) { return +(x.beforeMape * 100).toFixed(2); }),
              borderColor: "#94a3b8", backgroundColor: "rgba(148,163,184,.12)", borderDash: [5, 4],
              tension: .3, pointRadius: 3, borderWidth: 1.8
            },
            {
              label: "学习后 MAPE", data: plotted.map(function (x) { return +(x.afterMape * 100).toFixed(2); }),
              borderColor: "#008752", backgroundColor: "rgba(0,135,82,.12)", fill: true,
              tension: .3, pointRadius: 3, borderWidth: 2.2
            }
          ]
        },
        options: baseOpts({
          scales: {
            x: { grid: GRID, ticks: TICK },
            y: { grid: GRID, ticks: Object.assign({}, TICK, { callback: function (v) { return v + "%"; } }), beginAtZero: true }
          }
        })
      });
    }
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
         * 加系统性偏移是有意的：这样才能演示「学习前系统性偏差 → 学习后收敛」的完整闭环。
         * 若只加无偏噪声，MAPE 无论学习与否都等于噪声本身，看不出学习的价值。 */
        var noise = 1 + (Math.random() - 0.5) * 0.16;
        rows.push({ station: s.name, date: ds, inbound: Math.round(p.daily * 1.22 * noise), outbound: null });
      }
    });
    S.records = rows;
    S.fields = { mode: "long", station: 0, date: 1, hour: -1, inbound: 2, outbound: -1 };
    S.fileName = "示例数据（自动生成）";
    var names = Array.from(new Set(rows.map(function (r) { return r.station; })));
    var dates = Array.from(new Set(rows.map(function (r) { return r.date; }))).sort();
    $("impSummary").innerHTML = '<div class="res-bar ok">已生成示例数据 <b>' + fmtInt(rows.length) + '</b> 条 · '
      + names.length + ' 个站 · ' + dates.length + ' 天</div>'
      + '<div class="note note-warn">这是<b>以当前模型为底、人为加了 22% 系统性高估 + ±8% 随机噪声</b>生成的演示数据，'
      + '只用来验证「导入 → 回测 → 学习 → 复测」这条链路能否跑通，以及展示误差收敛的效果。'
      + '它<b>不能</b>证明模型准确——真实数据请用正式报表替换。</div>';
    $("fieldMap").innerHTML = '<div style="flex:1"><label class="fl">识别结果</label>'
      + '<div class="note note-ok" style="margin:0">示例数据（长表）：站名 | 日期 | 进站量</div></div>';
    renderPreview();
    $("btnBacktest").disabled = false;
    $("btnApply").disabled = false;
  }

  /* ================= 渲染调度 ================= */
  function renderAll() {
    S.dayLabel = { holiday: "法定节假日", makeup: "调休补班", saturday: "周六", sunday: "周日", weekday: "工作日" }[Model.dayClass(S.date)];
    renderOverview();
    renderLinePage();
    updateChips();
  }

  function updateChips() {
    $("chipDate").textContent = S.date + " " + (S.dayLabel || "");
    var d = Model.daysBetween("2026-09-16", S.date);
    $("chipOpenDays").textContent = "开通第 " + d + " 天";
    var c4 = Calib.getLineCalibration("4"), c6 = Calib.getLineCalibration("6");
    var n = Calib.history().length;
    $("chipCalib").textContent = (c4 || c6)
      ? "基准：已学习" + (n ? "（" + n + " 次）" : "")
      : "基准：推算值";
  }

  /* ================= 初始化 ================= */
  function init() {
    /* 试乘期声明（用户原话，不做改写） */
    if ($("trialText")) $("trialText").textContent = TRIAL_NOTICE;

    var g = $("gDate");
    g.value = S.date;
    g.onchange = function () { S.date = this.value || todayStr(); renderAll(); };
    $("gWeather").onchange = function () { S.weather = this.value; renderAll(); };
    $("gToday").onclick = function () { S.date = todayStr(); g.value = S.date; renderAll(); };

    /* 尝鲜衰减开关 + 说明 */
    var NOV_NOTE = {
      on: "启用：预测的是「正式运营后的常态水平」。开通初期的尝鲜客流按 1+0.45·e^(−t/35) 逐日剥离，第 35 天约为 1.17 倍，半年后趋于 1.00。",
      off: "关闭：不做剥离，保留开通初期的放大量，用于查看「刚开通那几天可能有多挤」。日常预测请保持启用。"
    };
    function paintNovNote() {
      if ($("novNote")) $("novNote").textContent = RUNTIME.applyNovelty ? NOV_NOTE.on : NOV_NOTE.off;
    }
    Array.prototype.forEach.call(document.querySelectorAll("#gNovelty button"), function (b) {
      b.onclick = function () {
        Array.prototype.forEach.call(this.parentNode.children, function (x) { x.classList.remove("on"); });
        this.classList.add("on");
        RUNTIME.applyNovelty = this.dataset.nov === "1";
        paintNovNote();
        renderAll();
      };
    });
    paintNovNote();

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
    initCalibPage();
    renderAll();

    $("footDate").textContent = todayStr();
  }

  return { init: init, S: S, renderAll: renderAll };
})();

document.addEventListener("DOMContentLoaded", function () { App.init(); });
