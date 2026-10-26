/* =====================================================================
 * data.js — 数据层
 * 厦门地铁新线（4号线 / 6号线）客流预测平台
 *
 * 原则：每一个数值都必须标注来源等级，不允许出现无法溯源的"裸数"。
 *   A = 官方发布 / 政府文件 / 运营企业公告
 *   B = 主流媒体报道（含记者现场采访数据）
 *   C = 行业公认文献或同类城市经验值
 *   D = 本平台推算（基于上述数据的外推，误差不可控，页面必须显式标注）
 * =================================================================== */

/* ---------- 1. 线路元信息 ---------- */
var LINES = {
  "4": {
    id: "4",
    name: "4号线",
    fullName: "4号线一期（集美软件园北—前浯）",
    color: "#E60012",           /* 活力红 C0 M100 Y100 K0 —— 厦门地铁官方标志色 */
    lengthKm: 45,               /* A: 网易/海峡导报 2026-09-16 报道 */
    stationCountTotal: 11,      /* B: 同上，全线规划设站数 */
    stationCountOpen: 8,        /* B: 本地宝 2026-09-18，实际开通试乘 8 座 */
    designSpeed: 120,           /* A: 福建首条设计时速120km全自动运行快线 */
    goa: "GoA4 全自动运行（无人值守）",
    openDate: "2026-09-16",     /* A: 试乘首日 */
    baselineDailyStable: 32000, /* D: 推算值，见 ASSUMPTIONS */
    baselineReliability: "D",
    features: [
      "福建首条设计时速 120 km 的快线，也是首条开进同安区的地铁线路",
      "全线 GoA4 全自动运行，无驾驶室，可车头观景",
      "官浔—城场段贴海而行，是厦门第二条海景地铁线路"
    ],
    notes: [
      "翔安机场段（含西岩、机场西、翔安机场等站）尚未开通，需待翔安机场通航后同步投用",
      "试乘期间免费、不刷卡，因此 4 号线自身客流不计入官方全网客运量统计"
    ]
  },
  "6": {
    id: "6",
    name: "6号线",
    fullName: "6号线（林埭西—华侨大学段 + 漳州角美延伸段）",
    color: "#7B2CBF",           /* 缤纷紫 C50 M90 Y0 K0 —— 厦门地铁官方标志色 */
    lengthKm: 28.3,             /* A: 厦门日报 2026-07-31 */
    stationCountTotal: 20,      /* A: 同上 */
    stationCountOpen: 18,       /* A: 本地宝时刻表，石美、龙江明珠暂无首末班时刻 */
    designSpeed: 80,            /* A: 福建日报 2026-09-16 */
    goa: "GoA4 全自动运行",
    openDate: "2026-09-16",
    baselineDailyStable: 48000, /* D: 由首日观测 7 万反推，见 ASSUMPTIONS */
    baselineReliability: "D",
    features: [
      "福建首条跨市域地铁，串联厦门集美、海沧与漳州角美",
      "20 座车站全部为地下站，4 节编组",
      "华侨大学站实现地铁与 BRT 免安检直接换乘"
    ],
    notes: [
      "石美、龙江明珠两站在本地宝时刻表中无首末班时刻，判定为暂缓开通",
      "试乘期间开行「华侨大学—角江路」交路，角江路为当前实际运营终点"
    ]
  }
};

/* ---------- 2. 站点 types 与权重常数 ---------- */
/* 站点类型基础权重 —— 代表同腹地条件下该类站点的相对客流吸引力 */
var TYPE_WEIGHT = {
  "枢纽": 1.00,
  "换乘": 0.86,
  "商圈": 0.80,
  "文教": 0.68,
  "居住": 0.58,
  "产业": 0.54,
  "景区": 0.50
};
var W_TRANSFER = 0.22;   /* 每接入 1 条地铁换乘线的加成（换乘只是部分需求来源，增量不超过基重的 1/4） */
var W_TERMINAL = 0.16;   /* 线路端点站加成（辐射半径单向扩大） */
var W_CATCHMENT = 0.11;  /* 腹地等级（1~5）每级的加成 */

/* ---------- 3. 站点清单 ---------- */
/* catchment: 腹地辐射人口/岗位等级 1~5（依据行政区成熟度、周边建成度定性判定，D级）
 * transfers: 接入的地铁换乘线路；BRT 换乘另计
 * status   : open=正常运营 | pending=暂缓开通
 */
var STATIONS = [
  /* ===== 4 号线（自西北向东南） ===== */
  { line:"4", name:"集美软件园北", seq:1, district:"集美区", type:"产业",   catchment:3, transfers:[],            brt:false, terminal:true,  status:"open" },
  { line:"4", name:"后溪",         seq:2, district:"集美区", type:"居住",   catchment:2, transfers:[],            brt:false, terminal:false, status:"open" },
  { line:"4", name:"厦门北站",     seq:3, district:"集美区", type:"枢纽",   catchment:5, transfers:["1号线"],     brt:true,  terminal:false, status:"open" },
  { line:"4", name:"官浔",         seq:4, district:"同安区", type:"换乘",   catchment:3, transfers:[],            brt:true,  terminal:false, status:"open" },
  { line:"4", name:"丙洲",         seq:5, district:"同安区", type:"景区",   catchment:2, transfers:[],            brt:false, terminal:false, status:"open" },
  { line:"4", name:"城场",         seq:6, district:"同安区", type:"居住",   catchment:2, transfers:[],            brt:false, terminal:false, status:"open" },
  { line:"4", name:"洪坑",         seq:7, district:"翔安区", type:"换乘",   catchment:3, transfers:["3号线"],     brt:false, terminal:false, status:"open" },
  { line:"4", name:"前浯",         seq:8, district:"翔安区", type:"居住",   catchment:4, transfers:[],            brt:false, terminal:true,  status:"open" },

  /* ===== 6 号线（自东北华侨大学向西南龙江明珠） ===== */
  { line:"6", name:"华侨大学",     seq:1,  district:"集美区",   type:"文教", catchment:4, transfers:[],            brt:true,  terminal:true,  status:"open" },
  { line:"6", name:"杏林湾",       seq:2,  district:"集美区",   type:"商圈", catchment:3, transfers:[],            brt:false, terminal:false, status:"open" },
  { line:"6", name:"官任",         seq:3,  district:"集美区",   type:"换乘", catchment:5, transfers:["1号线"],     brt:true,  terminal:false, status:"open" },
  { line:"6", name:"董任",         seq:4,  district:"集美区",   type:"居住", catchment:2, transfers:[],            brt:false, terminal:false, status:"open" },
  { line:"6", name:"内茂",         seq:5,  district:"集美区",   type:"居住", catchment:3, transfers:[],            brt:false, terminal:false, status:"open" },
  { line:"6", name:"杏滨",         seq:6,  district:"集美区",   type:"商圈", catchment:3, transfers:[],            brt:false, terminal:false, status:"open" },
  { line:"6", name:"碑头",         seq:7,  district:"集美区",   type:"居住", catchment:2, transfers:[],            brt:false, terminal:false, status:"open" },
  { line:"6", name:"西滨",         seq:8,  district:"集美区",   type:"居住", catchment:2, transfers:[],            brt:false, terminal:false, status:"open" },
  { line:"6", name:"陈井",         seq:9,  district:"集美区",   type:"居住", catchment:2, transfers:[],            brt:false, terminal:false, status:"open" },
  { line:"6", name:"马銮中心",     seq:10, district:"海沧区",   type:"换乘", catchment:4, transfers:["2号线"],     brt:false, terminal:false, status:"open" },
  { line:"6", name:"鼎美",         seq:11, district:"海沧区",   type:"换乘", catchment:2, transfers:["2号线"],     brt:false, terminal:false, status:"open" },
  { line:"6", name:"林埭",         seq:12, district:"海沧区",   type:"商圈", catchment:3, transfers:[],            brt:false, terminal:false, status:"open" },
  { line:"6", name:"一农",         seq:13, district:"海沧区",   type:"居住", catchment:2, transfers:[],            brt:false, terminal:false, status:"open" },
  { line:"6", name:"角美东",       seq:14, district:"漳州台商投资区", type:"居住", catchment:3, transfers:[],      brt:false, terminal:false, status:"open" },
  { line:"6", name:"角海路",       seq:15, district:"漳州台商投资区", type:"商圈", catchment:3, transfers:[],      brt:false, terminal:false, status:"open" },
  { line:"6", name:"文圃路",       seq:16, district:"漳州台商投资区", type:"居住", catchment:2, transfers:[],      brt:false, terminal:false, status:"open" },
  { line:"6", name:"角美中心",     seq:17, district:"漳州台商投资区", type:"商圈", catchment:4, transfers:[],      brt:false, terminal:false, status:"open" },
  { line:"6", name:"角江路",       seq:18, district:"漳州台商投资区", type:"商圈", catchment:3, transfers:[],      brt:false, terminal:true,  status:"open" },
  { line:"6", name:"石美",         seq:19, district:"漳州台商投资区", type:"居住", catchment:1, transfers:[],      brt:false, terminal:false, status:"pending" },
  { line:"6", name:"龙江明珠",     seq:20, district:"漳州台商投资区", type:"居住", catchment:1, transfers:[],      brt:false, terminal:true,  status:"pending" }
];

/* ---------- 4. BRT 换乘站 ---------- */
/* 官方口径 5 座 + 本次新线新增 2 座（官浔×4号线、华侨大学×6号线）
 * peakBias: 早/晚高峰形态倾向
 *   "residential" = 居住导向，早高峰以"进站"为主
 *   "employment"  = 岗位导向，早高峰以"出站"为主
 *   "balanced"    = 双向均衡
 */
var BRT_TRANSFER = [
  { station:"厦门北站",   metroLine:"4", metroAlso:["1号线"], brtLine:"BRT 集美线 / 快1",   peakBias:"balanced",    level:"A",
    note:"国家铁路枢纽 + 地铁 1/4 号线 + BRT，客流量级最大" },
  { station:"官浔",       metroLine:"4", metroAlso:[],        brtLine:"BRT 同安线 / 快2",   peakBias:"residential", level:"A",
    note:"4 号线新增换乘站，同安片区进入轨道网的门户" },
  { station:"华侨大学",   metroLine:"6", metroAlso:[],        brtLine:"BRT 集美线 / 快1",   peakBias:"balanced",    level:"A",
    note:"6 号线北端终点，免安检直接换乘 BRT；同时是集美文教组团核心" },
  { station:"文灶",       metroLine:"1", metroAlso:[],        brtLine:"BRT 主线",           peakBias:"employment",  level:"A",
    note:"老三线换乘站，位于岛内成熟就业区" },
  { station:"蔡塘",       metroLine:"2", metroAlso:[],        brtLine:"BRT 主线",           peakBias:"balanced",    level:"A",
    note:"2 号线换乘站，周边居住与商业混合" },
  { station:"火车站",     metroLine:"3", metroAlso:[],        brtLine:"BRT 主线",           peakBias:"balanced",    level:"A",
    note:"厦门站 + 地铁 3 号线 + BRT，对外交通枢纽属性强" },
  { station:"双十中学",   metroLine:"3", metroAlso:[],        brtLine:"BRT 主线（湖里创新园）", peakBias:"employment", level:"A",
    note:"3 号线换乘站，湖里创新园通勤目的地，早晚高峰对称性最明显" }
];

/* BRT 全网基准 —— 用于推算换乘量占比 */
var BRT_BASE = {
  dailyInbound: 215400,   /* A: 厦门市财政局答复函，2025 年 BRT 客运 7861 万人次 → 日均 21.54 万 */
  year: 2025,
  source: "厦门市财政局关于市人大代表建议的答复函（2025 年 BRT 全年客运 7861 万人次）",
  metroDaily: 753400,     /* A: 同期地铁日均 75.34 万，地铁分担率 35.8% */
  reliability: "A"
};

/* ---------- 5. 公开数据锚点 ---------- */
/* 这些是唯一可以用来校验模型的真实观测值，全部带出处 */
var ANCHORS = [
  { date:"2026-09-16", label:"双线试乘首日（周三）",
    metrics:[
      { key:"line6_inbound", value:70000, unit:"人次", text:"6 号线全线进站约 7 万", rel:"B",
        detail:"网友按各站安检数据统计：角美段 3 万出头 + 集美段 2 万多 + 海沧段 1 万出头。注：华侨大学站 BRT 免安检直接换乘，该部分未计入" },
      { key:"line4_top3", value:null, unit:"", text:"4 号线进站前三：厦门北站、洪坑站、前浯站", rel:"B",
        detail:"依据上午安检数据估算，原始作者已声明不一定正确、仅供参考", rel:"D" },
      { key:"network", value:920500, unit:"人次", text:"全网 92.05 万（不含 4/6 号线，因其不计入统计）", rel:"B",
        detail:"1 号线 36.14 万 + 2 号线 30.90 万 + 3 号线 25.01 万 = 92.05 万，与全网播报数完全吻合，可反证 4/6 号线客流确实未计入" },
      { key:"brt", value:230800, unit:"人次", text:"BRT 当日 23.08 万", rel:"B", detail:"地铁 + BRT 单日合计 115.13 万" }
    ]},
  { date:"2026-09-17", label:"试乘第 2 天（周四）",
    metrics:[ { key:"network", value:896900, unit:"人次", text:"全网 89.69 万", rel:"B", detail:"较前三日均值回落" } ]},
  { date:"2026-09-18", label:"试乘第 3 天（周五）",
    metrics:[
      { key:"network", value:982200, unit:"人次", text:"全网 98.22 万，同比上周五 +9.19%", rel:"B",
        detail:"1 号线 39.12 万 / 2 号线 32.51 万 / 3 号线 26.59 万；当日无演唱会、无大型赛事" },
      { key:"brt", value:243200, unit:"人次", text:"BRT 24.32 万", rel:"B", detail:"地铁 + BRT 单日合计 122.54 万" }
    ]},
  { date:"2026-09-15", label:"试乘前一日（周二）",
    metrics:[ { key:"network", value:801300, unit:"人次", text:"全网 80.13 万", rel:"B", detail:"周一 79.89 万，周二 80.13 万，作为 baseline 对照" } ]},
  { date:"2026-07/08", label:"暑期月度均值",
    metrics:[ { key:"network_avg", value:830000, unit:"人次/日", text:"7、8 月日均 83 万+，历史峰值日均 83.44 万", rel:"B", detail:"用于确认老三线常态盘子" } ]}
];

/* ---------- 6. 显式假设清单 ---------- */
/* 凡属 D 级推算，都必须在这里登记，页面上直接对用户展示 */
var ASSUMPTIONS = [
  { id:"newline_baseline_6", name:"6 号线稳定期日均基准 48,000 人次", level:"D",
    basis:"试乘首日观测 70,000 ÷ 首日放大系数 1.45", note:"见下方 novelty 模型" },
  { id:"newline_baseline_4", name:"4 号线稳定期日均基准 32,000 人次", level:"D",
    basis:"无首日总量观测。按站点权重法分配后，以厦门北站↔官任的进站量比值跨线推算", note:"本平台置信度最低的一项，强烈建议用真实数据导入替换" },
  { id:"novelty", name:"新线「尝鲜系数」1 + 0.45·e^(−t/35)", level:"C",
    basis:"北京交通发展研究院《提高轨道交通客流预测水平》：新线开通初期存在明显尝鲜客流，通常在 1~2 个月内衰减至常态", note:"取 35 天为衰减时间常数，首日取值 1.45" },
  { id:"growth", name:"3~5 年培育期，之后进入快速增长期", level:"A",
    basis:"北京交通发展研究院：国内轨道交通开通后 3~5 年为客流培育期，实际客流明显小于远期预测值；之后 10~15 年快速增长。北京 13 号线 2003—2006 年均递增 39.4%；广州 1 号线前 4 年年均仅 3.7%，2003—2006 年升至 20~25%", note:"本平台仅预测短期（≤1 年），不启用长期成长曲线" },
  { id:"network_effect", name:"网络效应：新线接入使既有线客流显著增长", level:"A",
    basis:"广州地铁 1 号线在 2 号线开通的次月，客流由 16 万增至 24 万（+50%）；上海 5 线成网后 1 号线诱增客流上升约 1/3", note:"因此本平台的「BRT 换乘站」模块对跨系统换乘单独建模" },
  { id:"free_fare", name:"免费试乘 vs 收费运营的换算系数 0.86", level:"D",
    basis:"交通需求价格弹性经验区间 −0.2 ~ −0.4，新线尝鲜期取中偏低值", note:"用户可在「运行参数」中切换票制状态" },
  { id:"transfer_ratio", name:"BRT↔地铁换乘客流占比", level:"D",
    basis:"无官方换乘量数据。按 7 座换乘站在各自线路 45 个 BRT 站中的权重占比推算", note:"真实值需 AFC 或 BRT 闸机配对数据才能确立" }
];

/* ---------- 7. 运行参数（可在页面上调整） ---------- */
var RUNTIME = {
  fareMode: "free",       /* free = 免费试乘 | paid = 正式收费运营 */
  applyNovelty: true,     /* 是否启用新线尝鲜衰减 */
  applyWeather: true
};

/* ---------- 8. 节假日日历（2026） ---------- */
/* 来源：国务院办公厅 2026 年部分节假日安排；Level A */
var HOLIDAYS_2026 = {
  holiday: {
    /* 元旦 */
    "2026-01-01":true,"2026-01-02":true,"2026-01-03":true,
    /* 春节（除夕 2-16） */
    "2026-02-15":true,"2026-02-16":true,"2026-02-17":true,"2026-02-18":true,"2026-02-19":true,
    "2026-02-20":true,"2026-02-21":true,"2026-02-22":true,"2026-02-23":true,
    /* 清明 */
    "2026-04-04":true,"2026-04-05":true,"2026-04-06":true,
    /* 劳动节 */
    "2026-05-01":true,"2026-05-02":true,"2026-05-03":true,"2026-05-04":true,"2026-05-05":true,
    /* 端午 */
    "2026-06-19":true,"2026-06-20":true,"2026-06-21":true,
    /* 中秋+国庆 */
    "2026-09-25":true,"2026-09-26":true,"2026-09-27":true,
    "2026-10-01":true,"2026-10-02":true,"2026-10-03":true,"2026-10-04":true,"2026-10-05":true,
    "2026-10-06":true,"2026-10-07":true,"2026-10-08":true
  },
  makeupWorkday: {
    /* 需要上班的调休日 */
    "2026-01-04":true,"2026-02-14":true,"2026-02-28":true,"2026-04-07":true,
    "2026-05-09":true,"2026-06-22":true,"2026-09-28":true,"2026-10-10":true
  },
  reliability: "A",
  source: "国务院办公厅关于 2026 年部分节假日安排的通知"
};

/* ---------- 9. 周内系数（工作日） ---------- */
/* 以周二为 1.00 基准。厦门为旅游+会展城市，周五晚间出行明显抬升 */
var DOW_COEF = { 1:1.01, 2:1.00, 3:1.00, 4:1.02, 5:1.10, 6:0.92, 0:0.86 };
/* 注：6/0（周六/日）的值仅在 type 未区分时使用，正常走 WEEKEND_TYPE 表 */

/* 站点类型 × 周末/假日 的响应系数 */
var WEEKEND_TYPE = {
  "枢纽": 1.13, "换乘": 1.06, "商圈": 1.25, "文教": 0.72,
  "居住": 0.90, "产业": 0.55, "景区": 1.48
};
var SATURDAY_EXTRA = {
  "枢纽": 1.19, "换乘": 1.17, "商圈": 1.29, "文教": 0.85,
  "居住": 1.02, "产业": 0.68, "景区": 1.33
};
var HOLIDAY_TYPE = {
  "枢纽": 1.50, "换乘": 1.20, "商圈": 2.30, "文教": 0.45,
  "居住": 0.95, "产业": 0.22, "景区": 2.50
};

/* 天气系数 —— 依据 2 篇独立实证文献标定（见 method.js 论文 2、3） */
var WEATHER_COEF = {
  "晴": 1.000, "多云": 0.992, "阴": 0.985, "小雨": 0.975, "中雨": 0.960,
  "大雨": 0.920, "暴雨": 0.850, "雷阵雨": 0.945, "雪": 0.780, "雾": 0.970, "浮尘": 0.965
};
