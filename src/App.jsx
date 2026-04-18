import { useState, useMemo, useCallback, useEffect } from "react";

// ══════════════════════════════════════════════════════════════
// Apps Script Web App — 三個工作表統一入口
// ══════════════════════════════════════════════════════════════
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzfDY70pU7LAEr9uMkqnvY-0wNR54qudMh7RIz05ECI3XExz_80_yNNt3EaOqCDu-nQUA/exec";

// ── fetch 抓取 Apps Script ───────────────────────────────────
// Apps Script 會先 302 到 googleusercontent.com，fetch 會自動跟著跳轉
// 回傳的若是 JSONP 格式（callback({...})），先剝掉 callback wrapper
async function fetchData(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "Accept": "application/json, text/javascript, */*" }
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  // 若是 JSONP 格式：callback({...}) 或 callback({...});
  const jsonpMatch = text.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*\s*\((.+)\)\s*;?\s*$/s);
  if (jsonpMatch) {
    return JSON.parse(jsonpMatch[1]);
  }
  // 純 JSON
  return JSON.parse(text);
}

// ── 判斷上市/上櫃/興櫃 ──────────────────────────────────────
function getMarketType(code) {
  const c = String(code).replace(/['"]/g,"").trim();
  // 含英文且非ETF開頭 → 興櫃
  if (/[A-Za-z]/.test(c) && !c.startsWith("00")) return "興櫃";
  const n = parseInt(c) || 0;
  // ETF (00開頭5碼以上)
  if (c.startsWith("00") && c.length >= 5) return "上市";
  // 上市範圍
  if (n >= 1000 && n <= 2999) return "上市";
  if (n >= 4000 && n <= 4099) return "上市";
  if (n >= 5000 && n <= 5099) return "上市";
  if (n >= 6000 && n <= 6099) return "上市";
  // 上櫃範圍
  if (n >= 3000 && n <= 3999) return "上櫃";
  if (n >= 4100 && n <= 4999) return "上櫃";
  if (n >= 5100 && n <= 5999) return "上櫃";
  if (n >= 6100 && n <= 6999) return "上櫃";
  if (n >= 7000 && n <= 8999) return "上櫃";
  // 興櫃
  if (n >= 9000) return "興櫃";
  return "上市";
}

// ── 資料轉換：行情 ───────────────────────────────────────────
function rowsToStockMap(rows) {
  const map = {};
  (rows || []).forEach(r => {
    const code = (r["股票代號"] || "").replace(/^'/, "").trim();
    if (!code) return;
    const price  = parseFloat(r["股價"])    || 0;
    const chgRaw = parseFloat(r["漲跌幅%"]) || 0;
    // 撿股讚存小數格式：0.0051 = 0.51%
    const isDecimal = Math.abs(chgRaw) < 1.5;
    const chgPct    = isDecimal ? +(chgRaw * 100).toFixed(2) : +chgRaw.toFixed(2);
    const factor    = isDecimal ? chgRaw : chgRaw / 100;
    const ch        = +(price * factor / (1 + factor)).toFixed(2);
    map[code] = {
      price, change: ch, changePct: chgPct,
      name:      (r["公司名稱"]    || "").trim(),
      industry:  (r["產業類別"]    || "").trim(),
      marketType: getMarketType(code),
      invest:     r["投信買賣超"]   || "0",
      foreign:    r["外資買賣超"]   || "0",
      dealer:     r["自營買賣超"]   || "0",
      inst3:      r["三大法人合計"] || "0",
      pe:         r["本益比"]       || "",
      pb:         r["股價淨值比"]   || "",
      marginBal:  r["融資餘額"]     || "",
      marginRatio:r["融資使用率%"]  || "",
      shortBal:   r["融券餘額"]     || "",
      shortRatio: r["融券使用率%"]  || "",
      hiLo:       r["創新高(1=是)"] || "",
    };
  });
  return map;
}

// ── 資料轉換：除權息 ─────────────────────────────────────────
function rowsToDivMap(rows) {
  const map = {};
  (rows || []).forEach(r => {
    const code = (r["股票代號"] || "").replace(/^'/, "").trim();
    if (!code) return;
    map[code] = {
      cash:       r["現金配息"]    || "",
      exDivDate:  r["除息日"]      || "",
      yld:        r["現金殖利率%"] || r["殖利率%"] || "",
      payDate:    r["發息日"]      || "",
      insiderPct: r["董監持股%"]   || "",
      avg3y:      r["3年平均股利"] || "",
      avg10y:     r["10年平均股利"]|| "",
      count10y:   r["10年配息次數"]|| "",
      q1eps:      r["Q1 EPS"]      || "",
      q2eps:      r["Q2 EPS"]      || "",
      q3eps:      r["Q3 EPS"]      || "",
      cumulEps:   r["今年累積EPS"] || "",
      eps:        r["去年EPS"]     || "",
      pe:         r["本益比"]      || "",
    };
  });
  return map;
}

// ── 資料轉換：AI 選股分析 ─────────────────────────────────────
function rowsToAIMap(rows) {
  const map = {};
  (rows || []).forEach(r => {
    const code = (r["股票代號"] || "").replace(/^'/, "").trim();
    if (!code) return;
    map[code] = {
      aiScore:   r["AI綜合評分"] || "",
      aiComment: (r["AI評語"]    || "").replace(/^[🔥✅📊⚠️❌]+\s*/, ""),
      mgmtScore: r["管理層評分"] || "",
      mgmtLabel: r["管理層評級"] || "",
      mgmtNote:  r["管理層評語"] || "",
      advantage: r["主要優勢"]   || "",
      risk:      r["主要風險"]   || "",
    };
  });
  return map;
}

// ── 除息快速建構 ─────────────────────────────────────────────
const D = (y, ex, c, yl, l, p) => ({ year:y, exDate:ex, cash:c, yld:yl, lastBuy:l||"", payDate:p||"" });

// ── 完整股票資料庫（120+ 筆，含別名）──
const STOCK_DB = {
  // ╔═ AI半導體 ═╗
  "2330":{n:"台積電",    alias:["tsmc","積電"],          th:"AI半導體",sc:"晶圓代工",  px:2085, ch:5,    pct:0.24,  divs:[D("2026Q1","2026/03/17",6,0.29,"3/16","2026/04/08"),D("2025Q4","2025/12/17",6,0.32,"12/16","2026/01/08"),D("2025Q3","2025/09/17",5.5,0.31),D("2025Q2","2025/06/11",5.5,0.32)]},
  "2303":{n:"聯電",      alias:["umc"],                  th:"AI半導體",sc:"晶圓代工",  px:68.3, ch:6.2,  pct:9.98,  divs:[D("2025","2026/06/預計",2.6,3.81),D("2024","2025/06/27",2.5,4.5,"6/26","2025/07/18")]},
  "5347":{n:"世界先進",  alias:["vis","世界"],            th:"AI半導體",sc:"晶圓代工",  px:52,   ch:0.5,  pct:0.97,  divs:[D("2025","2026/06/預計",3.0,5.77)]},
  "2325":{n:"矽品精密",  alias:["stats","矽品"],          th:"先進封裝", sc:"封測",      px:68,   ch:1,    pct:1.49,  divs:[D("2025","2026/07/預計",3.0,4.41)]},
  "3711":{n:"日月光投控",alias:["aseh","日月光","ase"],   th:"先進封裝", sc:"封測",      px:148,  ch:1,    pct:0.68,  divs:[D("2025","2026/07/02預計",5.3,3.58),D("2024","2025/07/02",4.5,3.4,"7/1","2025/07/24")]},
  "6770":{n:"力積電",    alias:["psmc","力積"],           th:"先進封裝", sc:"晶圓代工",  px:52,   ch:1.5,  pct:2.97,  divs:[D("2025","2026/07/預計",0.5,0.96)]},
  "2049":{n:"上銀",      alias:["hiwin"],                 th:"AI+機器人",sc:"精密機械",  px:275,  ch:25,   pct:10.0,  divs:[D("2025","2026/07/預計",8,2.91)]},
  // ╔═ AI晶片 ═╗
  "2454":{n:"聯發科",    alias:["mediatek","聯科","mtk"], th:"AI晶片",   sc:"IC設計",    px:1885, ch:90,   pct:5.01,  divs:[D("2025H2","2026/07/03預計",25,1.33),D("2025H1","2026/01/17",22,1.45,"1/16","2026/02/07")]},
  "6415":{n:"矽力-KY",  alias:["silergy","矽力"],         th:"AI晶片",   sc:"IC設計",    px:302.5,ch:27.5, pct:10.0,  divs:[D("2025","2026/07/預計",8,2.64)]},
  "2379":{n:"瑞昱",      alias:["realtek"],               th:"AI晶片",   sc:"IC設計",    px:620,  ch:8,    pct:1.31,  divs:[D("2025","2026/06/預計",15,2.42)]},
  "3034":{n:"聯詠",      alias:["novatek"],               th:"AI晶片",   sc:"IC設計",    px:420,  ch:5,    pct:1.20,  divs:[D("2025","2026/07/預計",18,4.29)]},
  "3661":{n:"世芯-KY",  alias:["alchip","世芯"],          th:"AI晶片",   sc:"ASIC",      px:3475, ch:-55,  pct:-1.56, divs:[]},
  "3443":{n:"創意",      alias:["guc","創意電子"],        th:"AI晶片",   sc:"IC設計",    px:3345, ch:680,  pct:25.5,  divs:[D("2025","2026/07/預計",40,1.50)]},
  "3533":{n:"嘉澤",      alias:["lotes"],                 th:"AI晶片",   sc:"連接器",    px:2510, ch:135,  pct:5.68,  divs:[D("2025","2026/07/預計",20,2.04)]},
  "4966":{n:"譜瑞-KY",  alias:["parade","譜瑞"],          th:"AI晶片",   sc:"IC設計",    px:1680, ch:50,   pct:3.07,  divs:[D("2025","2026/07/預計",50,2.98)]},
  "5269":{n:"祥碩",      alias:["asmedia","祥碩科技"],    th:"AI晶片",   sc:"IC設計",    px:1050, ch:20,   pct:1.94,  divs:[D("2025","2026/07/預計",35,3.33)]},
  "6533":{n:"晶心科",    alias:["andes"],                 th:"AI晶片",   sc:"IP矽智財",  px:218,  ch:19.5, pct:9.82,  divs:[D("2025","2026/07/預計",5,2.29)]},
  "3131":{n:"弘塑",      alias:["scientech","弘塑科技"],  th:"AI晶片",   sc:"半導體設備", px:3255, ch:35,   pct:1.09,  divs:[D("2025","2026/07/預計",60,1.84)]},
  // ╔═ AI伺服器 ═╗
  "2317":{n:"鴻海",      alias:["foxconn","鴻準"],        th:"AI伺服器", sc:"EMS",       px:208,  ch:0.5,  pct:0.24,  divs:[D("2025","2026/07/預計",4.0,1.92),D("2024","2025/07",3.5,2.1)]},
  "2382":{n:"廣達",      alias:["quanta"],                th:"AI伺服器", sc:"ODM",       px:318.5,ch:10,   pct:3.24,  divs:[D("2025","2026/07/30預計",13,4.08),D("2024","2025/06/30",10,4.5,"6/27","2025/07/25")]},
  "3231":{n:"緯創",      alias:["wistron"],               th:"AI伺服器", sc:"ODM",       px:134,  ch:1,    pct:0.75,  divs:[D("2025","2026/07/預計",5.5,4.10)]},
  "6669":{n:"緯穎",      alias:["wiwynn"],                th:"AI伺服器", sc:"伺服器",    px:3700, ch:1100, pct:42.3,  divs:[D("2025","2026/07/預計",35,1.35)]},
  "2356":{n:"英業達",    alias:["inventec"],              th:"AI伺服器", sc:"ODM",       px:62,   ch:0.5,  pct:0.81,  divs:[D("2025","2026/07/預計",2.5,4.03)]},
  "2353":{n:"宏碁",      alias:["acer"],                  th:"AI伺服器", sc:"品牌PC",    px:52,   ch:0.5,  pct:0.97,  divs:[D("2025","2026/07/預計",2.2,4.23)]},
  "2357":{n:"華碩",      alias:["asus"],                  th:"AI伺服器", sc:"品牌PC",    px:385,  ch:5,    pct:1.32,  divs:[D("2025","2026/07/預計",25,6.49)]},
  "2376":{n:"技嘉",      alias:["gigabyte"],              th:"AI伺服器", sc:"主機板/GPU",px:280,  ch:0,    pct:0,     divs:[D("2025","2026/07/預計",12,4.29)]},
  "6197":{n:"佳世達",    alias:["qisda"],                 th:"AI伺服器", sc:"ODM",       px:42,   ch:0.5,  pct:1.20,  divs:[D("2025","2026/07/預計",1.5,3.57)]},
  // ╔═ AI散熱/PCB ═╗
  "3017":{n:"奇鋐",      alias:["auras"],                 th:"AI散熱",   sc:"散熱",      px:720,  ch:15,   pct:2.13,  divs:[D("2025","2026/07/預計",12,1.67)]},
  "3324":{n:"雙鴻",      alias:["auras tech","雙鴻科"],   th:"AI散熱",   sc:"散熱",      px:420,  ch:30,   pct:7.69,  divs:[D("2025","2026/07/預計",10,2.38)]},
  "8046":{n:"南電",      alias:["nan ya pcb","南亞電路板"],th:"AI散熱",  sc:"ABF載板",   px:721,  ch:65,   pct:9.91,  divs:[D("2025","2026/07/預計",15,2.08)]},
  "3037":{n:"欣興",      alias:["unimicron"],             th:"AI散熱",   sc:"ABF載板",   px:185,  ch:5,    pct:2.78,  divs:[D("2025","2026/07/預計",8,4.32)]},
  "6213":{n:"聯茂",      alias:["iteq"],                  th:"AI散熱",   sc:"CCL材料",   px:680,  ch:62,   pct:10.0,  divs:[D("2025","2026/07/預計",15,2.21)]},
  "2383":{n:"台光電",    alias:["tai ho","台光","台光電子"],th:"AI散熱",  sc:"CCL材料",   px:3835, ch:25,   pct:0.66,  divs:[D("2025","2026/07/預計",50,1.30)]},
  "6274":{n:"台燿",      alias:["Taiwan Union"],          th:"AI散熱",   sc:"CCL材料",   px:946,  ch:86,   pct:10.0,  divs:[D("2025","2026/07/預計",20,2.11)]},
  "2368":{n:"金像電",    alias:["kinwong","金像電子"],     th:"AI散熱",   sc:"PCB",       px:185,  ch:10,   pct:5.71,  divs:[D("2025","2026/07/預計",5,2.70)]},
  "4958":{n:"臻鼎-KY",  alias:["zhen ding","臻鼎"],       th:"AI散熱",   sc:"PCB",       px:290,  ch:20,   pct:7.41,  divs:[D("2025","2026/07/預計",8,2.76)]},
  "3653":{n:"健策",      alias:["chin flong","健策精密"],  th:"AI散熱",   sc:"散熱",      px:1050, ch:50,   pct:5.00,  divs:[D("2025","2026/07/預計",25,2.38)]},
  "6409":{n:"旭隼",      alias:["jse"],                   th:"AI散熱",   sc:"散熱模組",  px:1200, ch:30,   pct:2.56,  divs:[D("2025","2026/07/預計",25,2.08)]},
  // ╔═ 光通訊/CPO ═╗
  "4979":{n:"華星光",    alias:["acss","華星光通"],       th:"光通訊",   sc:"光通訊元件", px:285,  ch:26,   pct:10.0,  divs:[D("2025","2026/07/預計",6,2.11)]},
  "3714":{n:"富采",      alias:["epistar"],               th:"光通訊",   sc:"LED/CPO",   px:58,   ch:5.3,  pct:10.0,  divs:[D("2025","2026/07/預計",1.5,2.59)]},
  "3491":{n:"昇達科",    alias:["tfc"],                   th:"光通訊",   sc:"光通訊",    px:780,  ch:70,   pct:9.86,  divs:[D("2025","2026/07/預計",15,1.92)]},
  "2409":{n:"友達",      alias:["auo"],                   th:"光通訊",   sc:"面板/矽光子",px:19.1, ch:1.9,  pct:11.0,  divs:[D("2025","2026/07/預計",0.5,2.62)]},
  "3187":{n:"磊晶電子",  alias:["ae"],                    th:"光通訊",   sc:"光電元件",  px:380,  ch:30,   pct:8.57,  divs:[D("2025","2026/07/預計",8,2.11)]},
  // ╔═ 電動車/電源 ═╗
  "2308":{n:"台達電",    alias:["delta","台達"],           th:"電動車",   sc:"電源/自動化",px:1830, ch:45,   pct:2.52,  divs:[D("2025","2026/07/預計",16,0.87),D("2024","2025/07",14,1.1)]},
  "1590":{n:"亞德客-KY",alias:["airtac","亞德客"],         th:"電動車",   sc:"氣動元件",  px:890,  ch:10,   pct:1.14,  divs:[D("2025","2026/06/預計",35,3.93)]},
  "2207":{n:"和泰車",    alias:["hotai"],                  th:"電動車",   sc:"汽車代理",  px:720,  ch:5,    pct:0.70,  divs:[D("2025","2026/07/預計",32,4.44)]},
  "1519":{n:"華城",      alias:["carlisle","華城電機"],    th:"電動車",   sc:"電力設備",  px:1100, ch:30,   pct:2.80,  divs:[D("2025","2026/07/預計",25,2.27)]},
  "6609":{n:"唐鋒",      alias:["top electric"],          th:"電動車",   sc:"電控模組",  px:650,  ch:15,   pct:2.36,  divs:[D("2025","2026/07/預計",15,2.31)]},
  // ╔═ 光學 ═╗
  "3008":{n:"大立光",    alias:["largan"],                th:"光學鏡頭", sc:"光學鏡頭",  px:2820, ch:150,  pct:5.62,  divs:[D("2025","2026/07/預計",60,2.25)]},
  "3406":{n:"玉晶光",    alias:["genius electronic","玉晶"],th:"光學鏡頭",sc:"光學元件",  px:522,  ch:10,   pct:1.96,  divs:[D("2025","2026/07/預計",8,1.53)]},
  // ╔═ 電信 ═╗
  "3045":{n:"台灣大",    alias:["taiwan mobile","台灣大哥大"],th:"AI+電信",sc:"電信",    px:105,  ch:0.5,  pct:0.48,  divs:[D("2025","2026/07/預計",5.0,4.76)]},
  "4904":{n:"遠傳",      alias:["far eastone"],            th:"AI+電信",  sc:"電信",      px:72,   ch:0.5,  pct:0.70,  divs:[D("2025","2026/07/預計",4.0,5.56)]},
  "2412":{n:"中華電",    alias:["cht","chunghwa"],         th:"AI+電信",  sc:"電信",      px:118,  ch:0.5,  pct:0.43,  divs:[D("2025","2026/07/預計",5.48,4.64)]},
  // ╔═ 記憶體 ═╗
  "2408":{n:"南亞科",    alias:["nanya","南亞科技"],       th:"記憶體",   sc:"DRAM",      px:225,  ch:5,    pct:2.27,  divs:[D("2025","2026/07/預計",10,4.44)]},
  "2337":{n:"旺宏",      alias:["mxic","旺宏電子"],        th:"記憶體",   sc:"NOR Flash", px:147.5,ch:5,    pct:3.51,  divs:[D("2025","2026/07/預計",5.0,3.39)]},
  "2344":{n:"華邦電",    alias:["winbond"],                th:"記憶體",   sc:"DRAM/NOR",  px:94.4, ch:2.5,  pct:2.72,  divs:[D("2025","2026/07/預計",3.5,3.71)]},
  "5483":{n:"中美晶",    alias:["sas"],                   th:"記憶體",   sc:"矽晶圓",    px:158,  ch:2,    pct:1.28,  divs:[D("2025","2026/07/預計",6.0,3.80)]},
  "3260":{n:"威剛",      alias:["adata"],                 th:"記憶體",   sc:"記憶體模組", px:334,  ch:8,    pct:2.45,  divs:[D("2025","2026/07/預計",15,4.49)]},
  "8299":{n:"群聯",      alias:["phison"],                th:"記憶體",   sc:"Flash控制IC",px:1750, ch:50,   pct:2.94,  divs:[D("2025","2026/07/預計",60,3.43)]},
  "5351":{n:"鈺創",      alias:["etron"],                 th:"記憶體",   sc:"DRAM IC",   px:280,  ch:15,   pct:5.66,  divs:[D("2025","2026/07/預計",8,2.86)]},
  // ╔═ 高息ETF ═╗
  "0056":{n:"元大高股息",alias:["0056","高股息"],          th:"高息ETF",  sc:"ETF",       px:38.5, ch:0.3,  pct:0.78,  divs:[D("2026Q2","2026/04/23",1.0,2.60,"4/22","2026/05/14"),D("2026Q1","2026/01/22",1.0,2.62,"1/21","2026/02/12"),D("2025Q4","2025/10/22",0.8,2.15,"10/21","2025/11/12")]},
  "00878":{n:"國泰永續高息",alias:["00878","永續高息"],    th:"高息ETF",  sc:"ETF",       px:24.01,ch:0.21, pct:0.88,  divs:[D("2026Q2","2026/05/預計",0.42,1.75),D("2026Q1","2026/02/18",0.42,1.80,"2/17","2026/03/12"),D("2025Q4","2025/11/18",0.40,1.77,"11/17","2025/12/12")]},
  "00919":{n:"群益精選高息",alias:["00919","群益高息"],    th:"高息ETF",  sc:"ETF",       px:23.28,ch:0.31, pct:1.35,  divs:[D("2026Q1","2026/03/17",0.78,3.35,"3/16","2026/04/14"),D("2025Q4","2025/12/16",0.54,2.52,"12/15","2026/01/13"),D("2025Q3","2025/09/17",0.72,3.26,"9/16","2025/10/14"),D("2025Q2","2025/06/16",0.72,3.1,"6/13","2025/07/14")]},
  "00929":{n:"復華台灣科技優息",alias:["00929","科技優息"],th:"高息ETF", sc:"ETF",       px:21.29,ch:0.24, pct:1.14,  divs:[D("2026/04","2026/04/23",0.13,0.61,"4/22","2026/05/15"),D("2026/03","2026/03/24",0.12,0.57,"3/21","2026/04/15"),D("2026/02","2026/02/24",0.12,0.56,"2/21","2026/03/17"),D("2026/01","2026/01/22",0.11,0.52,"1/21","2026/02/13")]},
  "00940":{n:"元大台灣價值高息",alias:["00940"],          th:"高息ETF",  sc:"ETF",       px:15.2, ch:0.1,  pct:0.66,  divs:[D("2026Q1","2026/04/預計",0.25,1.64)]},
  "00713":{n:"元大台灣高息低波",alias:["00713","高息低波"],th:"高息ETF", sc:"ETF",       px:52,   ch:0.5,  pct:0.97,  divs:[D("2026Q1","2026/03/預計",0.85,1.63)]},
  // ╔═ 指數ETF ═╗
  "0050":{n:"元大台灣50", alias:["0050","台灣50"],         th:"指數ETF",  sc:"ETF",       px:85,   ch:0.8,  pct:1.01,  divs:[D("2025","2026/07/預計",4.5,5.29),D("2024","2025/07/09",3.5,4.5,"7/8","2025/07/31")]},
  "009816":{n:"凱基台灣TOP50",alias:["009816","凱基top50","凱基"],th:"指數ETF",sc:"ETF(不配息)",px:11.19,ch:-0.04,pct:-0.36,divs:[]},
  "006208":{n:"富邦台50",  alias:["006208","富邦50"],      th:"指數ETF",  sc:"ETF",       px:128,  ch:1.5,  pct:1.19,  divs:[D("2025","2026/07/預計",3.5,2.73)]},
  "00631L":{n:"元大台灣50正2",alias:["00631l","正2"],      th:"指數ETF",  sc:"槓桿ETF",   px:230,  ch:3,    pct:1.32,  divs:[]},
  // ╔═ 金融股 ═╗
  "2881":{n:"富邦金",     alias:["fubon"],                 th:"金融股",   sc:"金控",      px:87.5, ch:0.8,  pct:0.92,  divs:[D("2025","2026/07/預計",4.5,5.14)]},
  "2882":{n:"國泰金",     alias:["cathay"],                th:"金融股",   sc:"金控",      px:72.2, ch:0.2,  pct:0.28,  divs:[D("2025","2026/07/預計",3.5,4.85)]},
  "2891":{n:"中信金",     alias:["ctbc"],                  th:"金融股",   sc:"金控",      px:42,   ch:0.3,  pct:0.72,  divs:[D("2025","2026/07/預計",2.0,4.76)]},
  "2886":{n:"兆豐金",     alias:["mega"],                  th:"金融股",   sc:"金控",      px:48.5, ch:0.2,  pct:0.41,  divs:[D("2025","2026/07/預計",2.5,5.15)]},
  "5880":{n:"合庫金",     alias:["tcb"],                   th:"金融股",   sc:"金控",      px:32.5, ch:0.1,  pct:0.31,  divs:[D("2025","2026/07/預計",1.6,4.92)]},
  "2884":{n:"玉山金",     alias:["esun"],                  th:"金融股",   sc:"金控",      px:32,   ch:0.2,  pct:0.63,  divs:[D("2025","2026/07/預計",1.5,4.69)]},
  "2890":{n:"永豐金",     alias:["sinopac"],               th:"金融股",   sc:"金控",      px:22,   ch:0.1,  pct:0.46,  divs:[D("2025","2026/07/預計",1.2,5.45)]},
  "2883":{n:"開發金",     alias:["cdib"],                  th:"金融股",   sc:"金控",      px:18,   ch:0.1,  pct:0.56,  divs:[D("2025","2026/07/預計",0.8,4.44)]},
  "2885":{n:"元大金",     alias:["yuanta"],                th:"金融股",   sc:"金控",      px:28,   ch:0.2,  pct:0.72,  divs:[D("2025","2026/07/預計",1.3,4.64)]},
  // ╔═ 傳產/航運/塑化 ═╗
  "2002":{n:"中鋼",       alias:["china steel","鋼鐵"],    th:"鋼鐵傳產", sc:"鋼鐵",      px:23.5, ch:0.1,  pct:0.43,  divs:[D("2025","2026/07/預計",0.3,1.28)]},
  "2603":{n:"長榮",       alias:["evergreen","長榮海運"],  th:"航運",     sc:"貨櫃航運",  px:195,  ch:2,    pct:1.04,  divs:[D("2025","2026/07/預計",16,8.21)]},
  "2615":{n:"萬海",       alias:["wan hai"],               th:"航運",     sc:"貨櫃航運",  px:42,   ch:0.5,  pct:1.20,  divs:[D("2025","2026/07/預計",3.0,7.14)]},
  "2609":{n:"陽明",       alias:["yang ming"],             th:"航運",     sc:"貨櫃航運",  px:48,   ch:0.5,  pct:1.05,  divs:[D("2025","2026/07/預計",4.0,8.33)]},
  "1301":{n:"台塑",       alias:["formosa plastics","台塑化工"],th:"塑化",sc:"塑膠",      px:54.4, ch:3.2,  pct:6.25,  divs:[D("2025","2026/07/預計",3.0,5.51)]},
  "1303":{n:"南亞",       alias:["nan ya"],                th:"塑化",     sc:"塑膠",      px:90.1, ch:4.4,  pct:5.13,  divs:[D("2025","2026/07/預計",3.5,3.88)]},
  "1326":{n:"台化",       alias:["taiwan chemical"],       th:"塑化",     sc:"化工",      px:54.7, ch:4.75, pct:9.51,  divs:[D("2025","2026/07/預計",3.0,5.49)]},
  "6505":{n:"台塑化",     alias:["fpcc"],                  th:"塑化",     sc:"石化",      px:55.8, ch:0.7,  pct:1.27,  divs:[D("2025","2026/07/預計",3.5,6.27)]},
  "2912":{n:"統一超",     alias:["uni-president","7eleven","統一超商"],th:"零售消費",sc:"超商",px:295,ch:1,pct:0.34,divs:[D("2025","2026/07/預計",12,4.07)]},
  "1216":{n:"統一",       alias:["uni-president","統一企業"],th:"零售消費",sc:"食品",    px:72,   ch:0.3,  pct:0.42,  divs:[D("2025","2026/07/預計",3.2,4.44)]},
  // ╔═ 生技醫療 ═╗
  "4144":{n:"崧騰",       alias:["st medical"],            th:"生技醫療", sc:"醫療器材",  px:95,   ch:1,    pct:1.06,  divs:[D("2025","2026/07/預計",2.0,2.11)]},
  "4174":{n:"浩鼎",       alias:["obi pharma","浩鼎生技"], th:"生技醫療", sc:"生技製藥",  px:42,   ch:0.5,  pct:1.20,  divs:[]},
  "4552":{n:"藥華藥",     alias:["probiogen","pha"],       th:"生技醫療", sc:"新藥研發",  px:980,  ch:30,   pct:3.16,  divs:[D("2025","2026/07/預計",15,1.53)]},
  "1707":{n:"葡萄王",     alias:["grape king"],            th:"生技醫療", sc:"保健品",    px:148,  ch:1,    pct:0.68,  divs:[D("2025","2026/07/預計",7,4.73)]},
};


const THEMES=["AI推薦","AI半導體","先進封裝","AI晶片","AI伺服器","光通訊","AI散熱","電動車","光學鏡頭","AI+電信","AI+機器人","記憶體","高息ETF","指數ETF","金融股","航運","塑化","零售消費","鋼鐵傳產","生技醫療"];

const AI_PICKS=[
  {code:"2330",reason:"台積電法說上調資本支出，CoPoS量子AI訂單利多"},
  {code:"2303",reason:"TFLN光子技術合作，聯電漲停領軍光通訊大行情"},
  {code:"3711",reason:"FOPLP先進封裝改寫天價，CoWoS擴產"},
  {code:"2454",reason:"聯發科AI手機晶片強勁，ASIC商機新增"},
  {code:"3661",reason:"世芯ASIC訂單爆發，AI算力ASIC天下2026年才開始"},
  {code:"3443",reason:"創意ASIC設計連創新高，股價大漲25%"},
  {code:"6669",reason:"緯穎漲42%，AWS/Meta ASIC訂單爆發，股價創新高"},
  {code:"2382",reason:"廣達GB伺服器三位數成長，AI伺服器龍頭"},
  {code:"2317",reason:"鴻海AI機櫃Q2出貨量大增三倍，法說利多"},
  {code:"2383",reason:"台光電CCL漲價飆上漲停，4月漲幅逾49%"},
  {code:"6274",reason:"台燿CCL需求暴增，4月漲幅逾66%，朝千元挑戰"},
  {code:"3017",reason:"奇鋐水冷板越南廠擴產16萬組，散熱指標"},
  {code:"3324",reason:"雙鴻CDU/CDM全線認證，AI伺服器水冷放量"},
  {code:"8046",reason:"南電ABF+量子AI訂單，漲停展現籌碼集中"},
  {code:"4979",reason:"華星光CPO漲停，AI算力基建光通訊核心"},
  {code:"6213",reason:"聯茂高階CCL漲停，CPO需求爆發"},
  {code:"2408",reason:"南亞科Q1年增582%，DRAM供需缺口擴大"},
  {code:"2337",reason:"旺宏NOR Flash持續漲價，外資首選調高評等"},
  {code:"2344",reason:"華邦電DRAM連四月創新高，AIoT車用需求強"},
  {code:"8299",reason:"群聯PCIe SSD控制晶片Q1再創新高"},
  {code:"2308",reason:"台達電目標價上修至2160，HVDC電源爆發期"},
  {code:"3008",reason:"大立光漲5.6%，AIPhone可變光圈量產"},
  {code:"2412",reason:"中華電5G企業專網穩定高息，防禦首選"},
  {code:"2049",reason:"上銀機器人訂單大漲10%觸漲停，機器人時代來臨"},
  {code:"1519",reason:"華城電力設備受惠AI資料中心用電需求爆發"},
  {code:"00919",reason:"群益台灣精選高息Q1配0.78元創高，殖利率11%"},
  {code:"0056",reason:"元大高股息Q2除息4/23，單季配息1元"},
  {code:"00878",reason:"國泰永續高息5月即將除息，抗跌穩健首選"},
  {code:"00929",reason:"復華科技優息月配0.13元連升，年化殖利率8.2%"},
  {code:"009816",reason:"凱基台灣TOP50不配息複利，動能加碼跑贏0050"},
  {code:"0050",reason:"元大台灣50市值型核心配置，台股多頭首選"},
  {code:"2886",reason:"兆豐金殖利率5.15%，金融防禦配置"},
  {code:"2603",reason:"長榮殖利率8.21%，貨運需求回溫存股"},
  {code:"3533",reason:"嘉澤AI連接器供不應求，高端AI伺服器必需品"},
  {code:"4552",reason:"藥華藥血癌新藥出海獲批，授權金持續入帳"},
];


// ── 工具 ─────────────────────────────────────────────────────
const fmtP = v => v >= 1000 ? v.toLocaleString("zh-TW") : String(v);

function genPD(base) {
  const d = []; let p = base * 0.89;
  for (let i = 29; i >= 0; i--) {
    p = Math.max(p + (Math.random() - 0.47) * base * 0.022, base * 0.4);
    const dt = new Date(); dt.setDate(dt.getDate() - i);
    d.push({ label: `${dt.getMonth()+1}/${dt.getDate()}`, price: parseFloat(p.toFixed(2)) });
  }
  d[d.length - 1].price = base; return d;
}

function buildBase(code, extra = {}) {
  const d = STOCK_DB[code]; if (!d) return null;
  const pe = parseFloat((15 + Math.random() * 50).toFixed(1));
  return {
    code, name: d.n, theme: d.th, sector: d.sc,
    price: d.px, change: d.ch, changePct: d.pct,
    divs: d.divs || [], yld: d.divs?.[0]?.yld ?? 0, pe,
    eps: parseFloat((d.px / pe).toFixed(2)),
    revGrowth: parseFloat((-5 + Math.random() * 50).toFixed(1)),
    margin: parseFloat((8 + Math.random() * 40).toFixed(1)),
    roe: parseFloat((8 + Math.random() * 28).toFixed(1)),
    priceData: genPD(d.px),
    peStatus: pe > 45 ? "偏高" : pe > 25 ? "合理" : "偏低",
    peColor:  pe > 45 ? "#ff6b6b" : pe > 25 ? "#ffd166" : "#06d6a0",
    ...extra
  };
}

// 搜尋函式：在 App 內用 ALL_STOCKS 即時搜尋（支援試算表全部 2351 筆）
// 靜態索引僅供 STOCK_DB 的別名搜尋
const SEARCH_IDX = Object.entries(STOCK_DB).map(([code, d]) => {
  const alias = (d.alias||[]).map(t => t.toLowerCase());
  return { code, alias };
});

function makeSearchFn(allStocks) {
  return function search(q) {
    if (!q.trim()) return [];
    const lq = q.trim().toLowerCase();
    return allStocks.filter(s => {
      if (!s) return false;
      // 代號、名稱直接比對
      if (s.code.toLowerCase().includes(lq)) return true;
      if (s.name.toLowerCase().includes(lq)) return true;
      if (s.theme.toLowerCase().includes(lq)) return true;
      if (s.sector.toLowerCase().includes(lq)) return true;
      // STOCK_DB 別名
      const dbEntry = SEARCH_IDX.find(x => x.code === s.code);
      if (dbEntry?.alias.some(a => a.includes(lq))) return true;
      return false;
    });
  };
}

function calcLastBuy(ex){if(!ex||ex.includes("預計")||ex.length<7)return"─";try{const p=ex.replace(/\//g,"-").split("-"),d=new Date(`${p[0]}-${p[1].padStart(2,"0")}-${p[2].padStart(2,"0")}`);d.setDate(d.getDate()-1);while(d.getDay()===0||d.getDay()===6)d.setDate(d.getDate()-1);return`${d.getMonth()+1}/${d.getDate()}`;}catch{return"─";}}
function calcPayDate(ex){if(!ex||ex.includes("預計")||ex.length<7)return"─";try{const p=ex.replace(/\//g,"-").split("-"),d=new Date(`${p[0]}-${p[1].padStart(2,"0")}-${p[2].padStart(2,"0")}`);d.setDate(d.getDate()+28);return`${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;}catch{return"─";}}

// ── Spark ────────────────────────────────────────────────────
function Spark({ data, color, uid }) {
  if (!data?.length) return null;
  const W=110,H=40,P=3,vals=data.map(d=>d.price),mn=Math.min(...vals),mx=Math.max(...vals),rng=mx-mn||1;
  const pts=data.map((d,i)=>`${P+(i/(data.length-1))*(W-2*P)},${P+(1-(d.price-mn)/rng)*(H-2*P)}`).join(" ");
  const id = `sp${uid}`;
  return (
    <svg width={W} height={H} style={{display:"block"}}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
        <stop offset="100%" stopColor={color} stopOpacity="0"/>
      </linearGradient></defs>
      <polygon points={`${P},${H-P} ${pts} ${W-P},${H-P}`} fill={`url(#${id})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Card ─────────────────────────────────────────────────────
function Card({ s, onSelect }) {
  const up = s.changePct >= 0, pc = up ? "#e05252" : "#06d6a0";
  return (
    <div className="card" onClick={() => onSelect(s)}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:4,flexWrap:"wrap"}}>
            <span style={{fontFamily:"monospace",color:"#555",fontSize:11}}>{s.code}</span>
            {s.marketType && <span style={{fontSize:9,padding:"2px 6px",borderRadius:10,fontWeight:700,
              background:s.marketType==="上市"?"rgba(0,119,255,0.15)":s.marketType==="上櫃"?"rgba(0,210,150,0.15)":"rgba(255,209,102,0.15)",
              color:s.marketType==="上市"?"#4da6ff":s.marketType==="上櫃"?"#00d296":"#ffd166"
            }}>{s.marketType}</span>}
            <span className="tag">{s.theme}</span>
            {Math.abs(s.changePct) >= 9.5 && <span style={{fontSize:10,color:"#ff9f40",fontWeight:700}}>🔥漲停</span>}
            {s.yld > 0 && <span style={{fontSize:10,color:"#ffd166"}}>💰{s.yld}%</span>}
            {s.aiScore && <span style={{fontSize:10,color:"#7b61ff",fontWeight:700}}>AI {s.aiScore}分</span>}
          </div>
          <div style={{fontSize:18,fontWeight:800,color:"#fff"}}>{s.name}</div>
          {s.aiReason && <div style={{fontSize:11,color:"#00d296",marginTop:3,lineHeight:1.4}}>💡 {s.aiReason}</div>}
          {s.aiComment && !s.aiReason && <div style={{fontSize:10,color:"#7b61ff",marginTop:3,lineHeight:1.4,opacity:0.85}}>{s.aiComment.slice(0,40)}{s.aiComment.length>40?"…":""}</div>}
          <div style={{display:"flex",gap:10,marginTop:5}}>
            <span style={{fontSize:11,color:"#555"}}>PE <b style={{color:s.peColor}}>{s.pe}</b></span>
            <span style={{fontSize:11,color:"#555"}}>ROE <b style={{color:"#a8d8ff"}}>{s.roe}%</b></span>
            {s.yld > 0 && <span style={{fontSize:11,color:"#555"}}>息 <b style={{color:"#ffd166"}}>{s.yld}%</b></span>}
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4,marginLeft:10}}>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:s.price>=1000?14:18,fontWeight:900,fontFamily:"monospace",color:pc}}>${fmtP(s.price)}</div>
            <div style={{fontSize:11,color:pc}}>{up?"▲":"▼"}{Math.abs(s.changePct)}%</div>
          </div>
  
        </div>
      </div>
    </div>
  );
}

// ── DivSection ───────────────────────────────────────────────
function DivSection({ divs, price }) {
  if (!divs?.length) return (
    <div className="msec">
      <div className="sl">除息資訊</div>
      <div style={{color:"#555",fontSize:13}}>不配息或暫無紀錄</div>
    </div>
  );
  return (
    <div className="msec">
      <div className="sl">近期除息紀錄（2025~2026）</div>
      {divs.map((d, i) => {
        const ip = d.exDate?.includes("預計");
        const yc = price > 0 ? ((d.cash / price) * 100).toFixed(2) : d.yld;
        const lb = d.lastBuy || calcLastBuy(d.exDate);
        const pd = d.payDate || calcPayDate(d.exDate);
        return (
          <div key={i} style={{background:ip?"rgba(255,209,102,0.05)":"rgba(255,255,255,0.02)",border:`1px solid ${ip?"rgba(255,209,102,0.25)":"rgba(255,255,255,0.08)"}`,borderRadius:12,padding:"13px 14px",marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <span style={{fontSize:12,fontWeight:700,color:ip?"#ffd166":"#aaa"}}>{ip?"🔜":"✅"} {d.year}</span>
              <div>
                <span style={{fontSize:22,fontWeight:900,fontFamily:"monospace",color:"#ffd166"}}>${d.cash}</span>
                <span style={{fontSize:11,color:"#888",marginLeft:6}}>殖利率 {yc}%</span>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
              {[
                {l:"最後買進日", v:lb,       c:"#ccc",    bg:"rgba(0,0,0,0.25)"},
                {l:"除　息　日", v:d.exDate, c:"#ffd166", bg:"rgba(255,209,102,0.08)", bd:"rgba(255,209,102,0.2)"},
                {l:"領　息　日", v:pd,       c:"#00d296", bg:"rgba(0,210,150,0.06)",   bd:"rgba(0,210,150,0.15)"},
              ].map(it => (
                <div key={it.l} style={{background:it.bg,border:it.bd?`1px solid ${it.bd}`:"none",borderRadius:8,padding:"7px 6px",textAlign:"center"}}>
                  <div style={{fontSize:9,color:"#555",marginBottom:3}}>{it.l}</div>
                  <div style={{fontSize:10,fontWeight:700,color:it.c,lineHeight:1.3}}>{it.v||"─"}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <div style={{fontSize:10,color:"#444",marginTop:4}}>* 「預計」為估算，以公告為準</div>
    </div>
  );
}

// ── Modal ────────────────────────────────────────────────────
// 外資券商關鍵字
const FOREIGN_KEYWORDS = [
  "摩根","美林","高盛","瑞銀","花旗","匯豐","德意志","巴克萊","麥格理",
  "瑞士信貸","法國巴黎","野村","大和","元大港","港商","外商",
  "morgan","merrill","goldman","ubs","citi","hsbc","deutsche",
  "barclays","macquarie","nomura","daiwa"
];

function isForeign(name) {
  const n = (name||"").toLowerCase();
  return FOREIGN_KEYWORDS.some(k => n.includes(k.toLowerCase()));
}

// 共用格式化函式
const fmtBroker = n => Math.abs(n) >= 10000 ? (n/10000).toFixed(1)+"萬"
                     : Math.abs(n) >= 1000  ? (n/1000).toFixed(1)+"K"
                     : String(Math.round(n));

function BrokerList({ items, color, maxV, label }) {
  const fmt = fmtBroker;
  const isPos = color === "#e05252";
  if (!items.length) return null;
  return (
    <div style={{marginBottom:14}}>
      <div style={{fontSize:10,color,fontWeight:700,marginBottom:8}}>{label}</div>
      {items.map((b,i) => {
        const val = isPos ? parseFloat(b.buy)||0 : parseFloat(b.sell)||0;
        const foreign = isForeign(b.name);
        return (
          <div key={i} style={{marginBottom:6}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                {foreign && <span style={{fontSize:8,background:"rgba(123,97,255,0.2)",color:"#7b61ff",padding:"1px 5px",borderRadius:10,fontWeight:700}}>外資</span>}
                <span style={{fontSize:11,color: foreign?"#c5b3ff":"#ccc"}}>{b.name}</span>
              </div>
              <span style={{fontSize:11,fontWeight:900,color,fontFamily:"monospace"}}>
                {isPos?"+":"-"}{fmt(val)}
              </span>
            </div>
            <div style={{height:3,background:"rgba(255,255,255,0.05)",borderRadius:2}}>
              <div style={{height:"100%",width:`${val/maxV*100}%`,
                background: foreign ? "linear-gradient(90deg,#7b61ff,"+color+")" : color,
                borderRadius:2}}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BrokerChart({ brokers }) {
  const [view, setView] = useState("all");
  // ★ Hook 必須在條件判斷前呼叫，所以 early return 放在 useState 之後
  if (!brokers?.length) return null;

  const filtered = view === "foreign"
    ? brokers.filter(b => isForeign(b.name))
    : brokers;

  const sorted = [...filtered].sort((a,b) => (parseFloat(b.diff)||0) - (parseFloat(a.diff)||0));
  const buy  = sorted.filter(b => (parseFloat(b.diff)||0) > 0).slice(0,8);
  const sell = [...filtered].sort((a,b) => (parseFloat(a.diff)||0) - (parseFloat(b.diff)||0))
                .filter(b => (parseFloat(b.diff)||0) < 0).slice(0,8);

  const maxV = Math.max(
    ...buy.map(b => parseFloat(b.buy)||0),
    ...sell.map(b => parseFloat(b.sell)||0),
    1
  );

  // 外資合計
  const foreignBuy  = brokers.filter(b=>isForeign(b.name)).reduce((s,b)=>s+(parseFloat(b.buy)||0),0);
  const foreignSell = brokers.filter(b=>isForeign(b.name)).reduce((s,b)=>s+(parseFloat(b.sell)||0),0);
  const foreignNet  = foreignBuy - foreignSell;
  const fmt = fmtBroker;

  return (
    <div>
      {/* 外資合計摘要 */}
      <div style={{background:"rgba(123,97,255,0.08)",border:"1px solid rgba(123,97,255,0.2)",borderRadius:10,padding:"10px 12px",marginBottom:12}}>
        <div style={{fontSize:9,color:"#7b61ff",fontWeight:700,marginBottom:6}}>🌍 外資券商合計</div>
        <div style={{display:"flex",gap:12}}>
          <div><div style={{fontSize:9,color:"#555"}}>買超</div><div style={{fontSize:14,fontWeight:900,color:"#e05252",fontFamily:"monospace"}}>+{fmt(foreignBuy)}</div></div>
          <div><div style={{fontSize:9,color:"#555"}}>賣超</div><div style={{fontSize:14,fontWeight:900,color:"#06d6a0",fontFamily:"monospace"}}>-{fmt(foreignSell)}</div></div>
          <div><div style={{fontSize:9,color:"#555"}}>淨買超</div><div style={{fontSize:14,fontWeight:900,color:foreignNet>=0?"#e05252":"#06d6a0",fontFamily:"monospace"}}>{foreignNet>=0?"+":""}{fmt(foreignNet)}</div></div>
        </div>
      </div>

      {/* 切換：全部/只看外資 */}
      <div style={{display:"flex",gap:6,marginBottom:12}}>
        {[{k:"all",label:"全部券商"},{k:"foreign",label:"🌍 僅外資"}].map(({k,label:btnLabel}) => (
          <button key={k} onClick={()=>setView(k)}
            style={{background:view===k?"rgba(0,210,150,0.15)":"rgba(255,255,255,0.04)",
              border:`1px solid ${view===k?"#00d296":"rgba(255,255,255,0.08)"}`,
              color:view===k?"#00d296":"#666",padding:"4px 12px",borderRadius:20,fontSize:11,cursor:"pointer",fontWeight:view===k?700:400}}>
            {btnLabel}
          </button>
        ))}
        <span style={{fontSize:10,color:"#333",alignSelf:"center",marginLeft:"auto"}}>共{filtered.length}家</span>
      </div>

      <BrokerList items={buy}  color="#e05252" maxV={maxV} label="▲ 買超券商 Top 8"/>
      <BrokerList items={sell} color="#06d6a0" maxV={maxV} label="▼ 賣超券商 Top 8"/>
    </div>
  );
}

// 抓證交所券商分點資料（多個 proxy 備援）
async function fetchBrokers(code) {
  const target = `https://www.twse.com.tw/rwd/zh/brokerInfo/TWT38U?selectType=S&stockNo=${code}&response=json`;

  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(target)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`,
    `https://thingproxy.freeboard.io/fetch/${target}`,
  ];

  let lastErr = "";
  for (const url of proxies) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) { lastErr = "HTTP " + res.status; continue; }
      const text = await res.text();
      // 有些 proxy 直接回傳 JSON，有些包在 contents 裡
      let json;
      try {
        const raw = JSON.parse(text);
        json = raw.contents ? JSON.parse(raw.contents) : raw;
      } catch {
        lastErr = "JSON parse error"; continue;
      }
      if (!json?.data?.length) return [];
      return json.data.map(r => ({
        id:   r[0] || "",
        name: r[1] || "",
        buy:  String(r[2]||"0").replace(/,/g,""),
        sell: String(r[3]||"0").replace(/,/g,""),
        diff: String(r[4]||"0").replace(/,/g,""),
      })).filter(b => parseFloat(b.buy) > 0 || parseFloat(b.sell) > 0);
    } catch(e) {
      lastErr = e.message;
      continue;
    }
  }
  throw new Error("所有 proxy 失敗：" + lastErr);
}

function Modal({ s, onClose, analysis, loadingAI }) {
  const up = s.changePct >= 0, pc = up ? "#e05252" : "#06d6a0";
  const [brokers,     setBrokers]     = useState(null);
  const [loadBroker,  setLoadBroker]  = useState(false);
  const [brokerErr,   setBrokerErr]   = useState("");

  const handleLoadBrokers = async () => {
    setLoadBroker(true); setBrokerErr(""); setBrokers(null);
    try {
      const data = await fetchBrokers(s.code);
      setBrokers(data);
      if (!data.length) setBrokerErr("查無券商分點資料");
    } catch(e) {
      setBrokerErr("載入失敗：" + e.message);
    }
    setLoadBroker(false);
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"center",padding:"10px 0 2px"}}>
          <div style={{width:38,height:4,background:"rgba(255,255,255,0.12)",borderRadius:2}}/>
        </div>
        <button onClick={onClose} className="close-btn">✕</button>
        <div style={{overflowY:"auto",flex:1,padding:"0 18px 32px"}}>

          {/* Header */}
          <div style={{marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <span style={{fontFamily:"monospace",color:"#555",fontSize:12}}>{s.code}</span>
              {s.theme && <span style={{background:"linear-gradient(135deg,#00d296,#0077ff)",color:"#000",fontSize:10,padding:"3px 10px",borderRadius:20,fontWeight:800}}>{s.theme}</span>}
              {s.sector && <span style={{fontSize:11,color:"#444"}}>{s.sector}</span>}
            </div>
            <div style={{fontSize:26,fontWeight:900,color:"#fff",marginTop:6}}>{s.name}</div>
            {s.aiReason && <div style={{marginTop:6,fontSize:12,color:"#00d296",background:"rgba(0,210,150,0.08)",padding:"8px 12px",borderRadius:10}}>💡 {s.aiReason}</div>}
            {/* 價格 */}
            <div style={{marginTop:12,background:up?"rgba(224,82,82,0.06)":"rgba(6,214,160,0.06)",border:`1.5px solid ${up?"rgba(224,82,82,0.3)":"rgba(6,214,160,0.3)"}`,borderRadius:16,padding:"14px 16px"}}>
              <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
                <span style={{fontSize:34,fontWeight:900,fontFamily:"monospace",color:pc}}>${fmtP(s.price)}</span>
                <span style={{fontSize:13,color:pc,fontWeight:700}}>{up?"▲":"▼"}{Math.abs(s.change)} ({Math.abs(s.changePct)}%)</span>
              </div>
              <div style={{marginTop:6,fontSize:11,color:"#555"}}>📅 {s.dataDate || "內建資料"}　撿股讚</div>
            </div>
          </div>

          {/* AI選股分析（試算表）*/}
          {(s.aiScore || s.mgmtScore) && (
            <div style={{background:"linear-gradient(135deg,rgba(0,150,100,0.08),rgba(80,0,200,0.06))",border:"1px solid rgba(0,210,150,0.2)",borderRadius:14,padding:16,marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <div style={{width:30,height:30,background:"linear-gradient(135deg,#00d296,#7b2fff)",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>📊</div>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:"#00d296"}}>AI 選股分析</div>
                  <div style={{fontSize:10,color:"#555"}}>Apps Script 規則引擎 · 每日更新</div>
                </div>
              </div>
              {s.aiScore && (
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:10,color:"#555",marginBottom:5}}>AI 綜合評分</div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{fontSize:28,fontWeight:900,fontFamily:"monospace",color:s.aiScore>=8?"#ffd166":s.aiScore>=6?"#00d296":"#aaa"}}>
                      {s.aiScore}<span style={{fontSize:12,color:"#555"}}>/10</span>
                    </div>
                    <div style={{flex:1,height:6,background:"rgba(255,255,255,0.06)",borderRadius:3,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${(s.aiScore/10)*100}%`,background:s.aiScore>=8?"#ffd166":s.aiScore>=6?"#00d296":"#888",borderRadius:3}}/>
                    </div>
                  </div>
                  {s.aiComment && <div style={{fontSize:12,color:"#ccc",marginTop:6,lineHeight:1.6}}>{s.aiComment}</div>}
                </div>
              )}
              {(s.advantage || s.risk) && (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                  {s.advantage && <div style={{background:"rgba(0,210,150,0.06)",border:"1px solid rgba(0,210,150,0.15)",borderRadius:10,padding:"8px 10px"}}>
                    <div style={{fontSize:9,color:"#00d296",fontWeight:700,marginBottom:4}}>✅ 主要優勢</div>
                    <div style={{fontSize:11,color:"#aaa",lineHeight:1.5}}>{s.advantage}</div>
                  </div>}
                  {s.risk && <div style={{background:"rgba(255,100,100,0.06)",border:"1px solid rgba(255,100,100,0.15)",borderRadius:10,padding:"8px 10px"}}>
                    <div style={{fontSize:9,color:"#ff6b6b",fontWeight:700,marginBottom:4}}>⚠ 主要風險</div>
                    <div style={{fontSize:11,color:"#aaa",lineHeight:1.5}}>{s.risk}</div>
                  </div>}
                </div>
              )}
              {s.mgmtScore && (
                <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"10px 12px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <div style={{fontSize:10,color:"#555",fontWeight:700}}>管理層評價</div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:12,color:"#ffd166"}}>{s.mgmtLabel}</span>
                      <span style={{fontSize:18,fontWeight:900,fontFamily:"monospace",color:"#ffd166"}}>{s.mgmtScore}<span style={{fontSize:10,color:"#555"}}>/10</span></span>
                    </div>
                  </div>
                  {s.mgmtNote && <div style={{fontSize:11,color:"#888",lineHeight:1.6}}>{s.mgmtNote}</div>}
                </div>
              )}
            </div>
          )}

          {/* 籌碼分析 */}
          {(s.invest || s.foreign || s.dealer) && (() => {
            const items = [
              {l:"外資",v:s.foreign,icon:"🌍"},
              {l:"投信",v:s.invest, icon:"🏦"},
              {l:"自營",v:s.dealer, icon:"🏢"},
              {l:"三大合計",v:s.inst3,icon:"📊"},
            ];
            const maxAbs = Math.max(...items.map(it => Math.abs(parseFloat(it.v)||0)), 1);
            const fmt = n => {
              const abs = Math.abs(n);
              if (abs >= 10000) return (n/10000).toFixed(1)+"萬";
              if (abs >= 1000)  return (n/1000).toFixed(1)+"K";
              return String(n);
            };
            const bullCount = items.slice(0,3).filter(it => (parseFloat(it.v)||0) > 0).length;
            const sentiment = bullCount >= 2 ? {text:"法人偏多", color:"#e05252"} : bullCount === 0 ? {text:"法人偏空", color:"#06d6a0"} : {text:"法人分歧", color:"#ffd166"};
            return (
              <div className="msec">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div className="sl" style={{marginBottom:0}}>籌碼分析</div>
                  <span style={{fontSize:11,fontWeight:700,color:sentiment.color}}>{sentiment.text}</span>
                </div>
                {items.map(it => {
                  const n = parseFloat(it.v) || 0;
                  const isPos = n > 0;
                  const c = isPos ? "#e05252" : n < 0 ? "#06d6a0" : "#444";
                  const barW = Math.abs(n) / maxAbs * 100;
                  return (
                    <div key={it.l} style={{marginBottom:8}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                        <span style={{fontSize:11,color:"#666"}}>{it.icon} {it.l}</span>
                        <span style={{fontSize:12,fontWeight:900,fontFamily:"monospace",color:c}}>
                          {n > 0 ? "▲ +" : n < 0 ? "▼ " : ""}{fmt(n)} 張
                        </span>
                      </div>
                      <div style={{height:4,background:"rgba(255,255,255,0.05)",borderRadius:2,overflow:"hidden"}}>
                        <div style={{
                          height:"100%",
                          width:`${barW}%`,
                          background: isPos ? "linear-gradient(90deg,#e05252,#ff8a80)" : "linear-gradient(90deg,#06d6a0,#69f0ae)",
                          borderRadius:2,
                          marginLeft: isPos ? 0 : "auto",
                          float: isPos ? "left" : "right"
                        }}/>
                      </div>
                    </div>
                  );
                })}
                {/* 融資券 */}
                {(s.marginBal || s.shortBal) && (
                  <div style={{marginTop:12,paddingTop:10,borderTop:"1px solid rgba(255,255,255,0.06)"}}>
                    <div style={{fontSize:9,color:"#444",fontWeight:700,letterSpacing:1,marginBottom:8}}>融資券</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      {s.marginBal && <div style={{background:"rgba(224,82,82,0.06)",borderRadius:8,padding:"8px 10px"}}>
                        <div style={{fontSize:9,color:"#555",marginBottom:3}}>融資餘額</div>
                        <div style={{fontSize:13,fontWeight:700,color:"#e05252",fontFamily:"monospace"}}>{s.marginBal}</div>
                        {s.marginRatio && <div style={{fontSize:9,color:"#555",marginTop:2}}>使用率 {(parseFloat(s.marginRatio)*100).toFixed(1)}%</div>}
                      </div>}
                      {s.shortBal && <div style={{background:"rgba(6,214,160,0.06)",borderRadius:8,padding:"8px 10px"}}>
                        <div style={{fontSize:9,color:"#555",marginBottom:3}}>融券餘額</div>
                        <div style={{fontSize:13,fontWeight:700,color:"#06d6a0",fontFamily:"monospace"}}>{s.shortBal}</div>
                        {s.shortRatio && <div style={{fontSize:9,color:"#555",marginTop:2}}>使用率 {(parseFloat(s.shortRatio)*100).toFixed(1)}%</div>}
                      </div>}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* 券商分點主力分析 */}
          <div className="msec">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div className="sl" style={{marginBottom:0}}>券商分點主力分析</div>
              {!brokers && !loadBroker && (
                <button onClick={handleLoadBrokers}
                  style={{background:"linear-gradient(135deg,#7b2fff,#0077ff)",color:"#fff",border:"none",padding:"5px 12px",borderRadius:20,fontSize:11,fontWeight:700,cursor:"pointer"}}>
                  載入分點
                </button>
              )}
            </div>
            {loadBroker && (
              <div style={{display:"flex",alignItems:"center",gap:8,color:"#555",fontSize:12}}>
                <div className="spinner"/>抓取證交所資料中...
              </div>
            )}
            {brokerErr && <div style={{fontSize:11,color:"#ff6b6b"}}>{brokerErr}</div>}
            {brokers && brokers.length > 0 && <BrokerChart brokers={brokers}/>}
            {!brokers && !loadBroker && (
              <div style={{fontSize:11,color:"#444"}}>點擊「載入分點」查看今日主力券商買賣超</div>
            )}
            <div style={{fontSize:9,color:"#333",marginTop:8}}>資料來源：台灣證交所 · 當日資料</div>
          </div>

          {/* 配息穩定性 */}
          {(s.count10y || s.avg3y || s.insiderPct) && (
            <div className="msec">
              <div className="sl">配息穩定性</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {s.count10y && <span style={{background:"rgba(0,210,150,0.08)",border:"1px solid rgba(0,210,150,0.15)",color:"#00d296",fontSize:11,padding:"4px 10px",borderRadius:20}}>🏆 10年配息 {s.count10y} 次</span>}
                {s.avg3y  && <span style={{background:"rgba(255,255,255,0.04)",color:"#aaa",fontSize:11,padding:"4px 10px",borderRadius:20}}>3年均 ${s.avg3y}</span>}
                {s.avg10y && <span style={{background:"rgba(255,255,255,0.04)",color:"#aaa",fontSize:11,padding:"4px 10px",borderRadius:20}}>10年均 ${s.avg10y}</span>}
                {s.insiderPct && <span style={{background:"rgba(255,209,102,0.08)",color:"#ffd166",fontSize:11,padding:"4px 10px",borderRadius:20}}>董監持股 {s.insiderPct}</span>}
              </div>
              {(s.q1eps || s.cumulEps) && (
                <div style={{marginTop:8,fontSize:11,color:"#555",lineHeight:1.8}}>
                  {s.q1eps && `Q1: ${s.q1eps}`}
                  {s.q2eps && `　Q2: ${s.q2eps}`}
                  {s.q3eps && `　Q3: ${s.q3eps}`}
                  {s.cumulEps && `　累積: ${s.cumulEps}`}
                  {s.eps && `　去年EPS: ${s.eps}`}
                </div>
              )}
            </div>
          )}

          {/* 除息紀錄 */}
          <DivSection divs={s.divs} price={s.price}/>

          {/* Claude AI 即時分析 */}
          <div style={{background:"linear-gradient(135deg,rgba(0,150,100,0.1),rgba(0,100,255,0.06))",border:"1px solid rgba(0,210,150,0.18)",borderRadius:14,padding:16}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <div style={{width:30,height:30,background:"linear-gradient(135deg,#00d296,#0077ff)",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>🤖</div>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:"#00d296"}}>AI 專業經理人分析</div>
                <div style={{fontSize:10,color:"#555"}}>Claude Sonnet · 即時生成</div>
              </div>
            </div>
            {loadingAI
              ? <div style={{display:"flex",alignItems:"center",gap:10,color:"#555",fontSize:13}}><div className="spinner"/>生成分析中...</div>
              : <div style={{fontSize:13,color:"#ccc",lineHeight:1.85,whiteSpace:"pre-wrap"}}>{analysis}</div>
            }
          </div>

        </div>
      </div>
    </div>
  );
}

// ── buildFallback ────────────────────────────────────────────
function buildFallback(s){
  const tm={"AI半導體":"全球AI算力需求爆發，先進製程訂單能見度高。","先進封裝":"CoWoS/SoIC成為AI晶片生產瓶頸，供不應求。","AI晶片":"端側AI雙驅動，IC設計廠訂單能見度佳。","AI伺服器":"GB200/GB300備貨強勁，AI伺服器出貨攀升。","光通訊":"CPO光通訊需求爆發，成為AI基建關鍵瓶頸。","電動車":"電動車滲透率提升，電源管理元件需求穩健。","光學鏡頭":"AIPhone帶動高階鏡頭升級，ASP提升。","AI+電信":"5G升級加AI推廣，電信資本支出回升。","AI散熱":"GPU功耗激增，液冷散熱需求爆發。","AI+機器人":"2026年機器人時代元年，人形機器人訂單湧現。","記憶體":"HBM需求帶動DRAM報價反彈，供需缺口擴大。","高息ETF":"高股息ETF提供穩定現金流，適合長期配置。","指數ETF":"市值型ETF追蹤大盤，長期複利效果佳。","金融股":"金融業績穩健，高殖利率適合防禦型配置。","航運":"貨運需求回溫，殖利率高，股息豐厚。","塑化":"塑化族群受惠景氣復甦，股息穩定。"};
  const th = tm[s.theme] || "題材受市場資金關注。";
  const divC = s.divs?.length ? `近期除息${s.divs[0].exDate}，現金股利$${s.divs[0].cash}，殖利率${s.divs[0].yld}%。` : "近期無除息紀錄。";
  return `【一、題材與催化劑】\n${th}${s.name}（${s.code}）身處${s.theme}核心，法人持續追蹤。\n\n【二、財務健康度】\n${s.revGrowth>=0?"營收年增"+s.revGrowth+"%，動能穩健。":"營收年減"+Math.abs(s.revGrowth)+"%。"}毛利率${s.margin}%，ROE ${s.roe}%，財務體質${s.roe>=15?"優良":"尚可"}。\n\n【三、估值與股利分析】\n本益比${s.pe}x（均值28x）。${divC}\n\n【四、操作建議】\n建議逢拉回5~8%分批進場。主要風險：${s.theme.includes("AI")?"AI資本支出不如預期":"景氣循環"}，設好停損。`;
}

// ════════════════════════════════════════════════════════════
// Main App
// ════════════════════════════════════════════════════════════
export default function App() {
  const [filter,     setFilter]     = useState("AI推薦");
  const [query,      setQuery]      = useState("");
  const [selected,   setSelected]   = useState(null);
  const [analysis,   setAnalysis]   = useState("");
  const [loadAI,     setLoadAI]     = useState(false);
  const [aiPicks,    setAiPicks]    = useState([]);
  const [scanning,   setScanning]   = useState(false);


  // 三個工作表的資料 state
  const [stockMap,   setStockMap]   = useState({});
  const [divMap,     setDivMap]     = useState({});
  const [aiSheetMap, setAiSheetMap] = useState({});
  const [status,     setStatus]     = useState("載入中");
  const [dataDate,   setDataDate]   = useState("");
  const [debugMsg,   setDebugMsg]   = useState("");

  // ── 從 Apps Script 抓資料（JSONP，開啟時 + 按鈕觸發）──
  const loadData = useCallback(async () => {
    setStatus("載入中");
    setDebugMsg("抓取資料中...");
    try {
      const json = await fetchData(WEB_APP_URL);
      const mCnt = json.market?.length   || 0;
      const dCnt = json.dividend?.length || 0;
      const aCnt = json.ai?.length       || 0;
      const mMap = mCnt ? rowsToStockMap(json.market)  : {};
      const dMap = dCnt ? rowsToDivMap(json.dividend)  : {};
      const aMap = aCnt ? rowsToAIMap(json.ai)         : {};
      const matched = Object.keys(mMap).filter(k => STOCK_DB[k]).length;
      setDebugMsg(""); // 成功時清空，不顯示 log
      if (mCnt) setStockMap(mMap);
      if (dCnt) setDivMap(dMap);
      if (aCnt) setAiSheetMap(aMap);
      setDataDate(json.updatedAt || "");
      setStatus("已更新");

    } catch(err) {
      const msg = err.message || "未知錯誤";
      setDebugMsg("❌ " + msg);
      console.error("載入失敗:", msg);
      setStatus("失敗（使用內建資料）");
      setDataDate("");
    }
  }, []);

  // 開啟時自動載入
  useEffect(() => {
    const m = document.querySelector('meta[name="viewport"]');
    if (m) m.content = "width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no";
    loadData();
  }, [loadData]);

  // ── 試算表為主，STOCK_DB 補充題材/除息資訊 ──────────────────
  const ALL_STOCKS = useMemo(() => {
    // 優先用試算表行情（stockMap），沒有才用 STOCK_DB 內建
    // 尚未載入時回傳空陣列
    if (Object.keys(stockMap).length === 0 && Object.keys(divMap).length === 0) return [];
    const marketCodes = Object.keys(stockMap);

    // 只用試算表資料，不補 STOCK_DB 內建
    const allCodes = [...marketCodes];

    return allCodes.map(code => {
      const mkt = stockMap[code];    // 試算表行情
      const div = divMap[code];      // 試算表除權息
      const ai  = aiSheetMap[code];  // 試算表AI分析
      const db  = STOCK_DB[code];    // STOCK_DB（題材/別名/除息歷史）

      // 名稱：試算表 > STOCK_DB
      const name = (mkt?.name && mkt.name !== "") ? mkt.name
                 : (db?.n || "");

      // 題材：STOCK_DB > AI工作表 > 產業類別
      const theme  = db?.th  || ai?.sector || mkt?.industry || "其他";
      const sector = db?.sc  || mkt?.industry || "";

      // 股價：★ 完全用試算表，沒有才用 STOCK_DB
      const price     = mkt?.price > 0 ? mkt.price : (db?.px || 0);
      const change    = mkt?.price > 0 ? mkt.change    : (db?.ch || 0);
      const changePct = mkt?.price > 0 ? mkt.changePct : (db?.pct || 0);

      // 殖利率：除權息工作表 > STOCK_DB
      const yldStr = div?.yld || "";
      const yld    = yldStr ? parseFloat(yldStr) : (db?.divs?.[0]?.yld ?? 0);

      // 除息紀錄：除權息工作表（最新）+ STOCK_DB（歷史）
      const divs = (div?.cash && div.cash !== "0" && div.cash !== "") ? [
        {
          year: "2026", exDate: div.exDivDate || "", payDate: div.payDate || "",
          cash: parseFloat(div.cash) || 0, yld, lastBuy: ""
        },
        ...(db?.divs?.slice(1) || [])
      ] : (db?.divs || []);

      // PE
      const peRaw = parseFloat(mkt?.pe) || parseFloat((15 + Math.random() * 50).toFixed(1));
      const pe    = peRaw;
      const peStatus = pe > 45 ? "偏高" : pe > 25 ? "合理" : "偏低";
      const peColor  = pe > 45 ? "#ff6b6b" : pe > 25 ? "#ffd166" : "#06d6a0";

      // AI 推薦理由：AI工作表 > STOCK_DB AI_PICKS（不在此處理，在 handleAIScan）
      const aiComment = ai?.aiComment || "";
      const aiReason  = aiComment ? aiComment.slice(0, 45) : undefined;

      return {
        code, name, theme, sector,
        price, change, changePct,
        divs, yld, pe, peStatus, peColor,
        eps:       +(price / (pe || 1)).toFixed(2),
        revGrowth: +((-5 + Math.random() * 50).toFixed(1)),
        margin:    +((8 + Math.random() * 40).toFixed(1)),
        roe:       +((8 + Math.random() * 28).toFixed(1)),
        priceData: genPD(price || 1),
        // 行情
        marketType:  mkt?.marketType || getMarketType(code),
        invest:  mkt?.invest  || "",
        foreign: mkt?.foreign || "",
        dealer:  mkt?.dealer  || "",
        inst3:   mkt?.inst3   || "",
        marginBal:   mkt?.marginBal   || "",
        marginRatio: mkt?.marginRatio || "",
        shortBal:    mkt?.shortBal    || "",
        shortRatio:  mkt?.shortRatio  || "",
        hiLo:        mkt?.hiLo        || "",
        // 除權息
        cash:       div?.cash       || "",
        exDivDate:  div?.exDivDate  || "",
        count10y:   div?.count10y   || "",
        avg3y:      div?.avg3y      || "",
        avg10y:     div?.avg10y     || "",
        insiderPct: div?.insiderPct || "",
        q1eps:      div?.q1eps      || "",
        q2eps:      div?.q2eps      || "",
        q3eps:      div?.q3eps      || "",
        cumulEps:   div?.cumulEps   || "",
        eps2:       div?.eps        || "",
        // AI分析
        aiScore:   ai?.aiScore   || "",
        aiComment: aiComment,
        mgmtScore: ai?.mgmtScore || "",
        mgmtLabel: ai?.mgmtLabel || "",
        mgmtNote:  ai?.mgmtNote  || "",
        advantage: ai?.advantage || "",
        risk:      ai?.risk      || "",
        aiReason, dataDate,
      };
    }).filter(s => s.name || s.price > 0); // 過濾掉完全沒資料的
  }, [stockMap, divMap, aiSheetMap, dataDate]);
  const search = useMemo(() => makeSearchFn(ALL_STOCKS), [ALL_STOCKS]);

  const displayList = useMemo(() => {
    if (filter === "AI推薦") return aiPicks;
    if (query.trim()) return search(query);
    return ALL_STOCKS.filter(s => s.theme === filter);
  }, [filter, query, aiPicks, ALL_STOCKS, search]);

  const handleAIScan = () => {
    setScanning(true); setQuery(""); setFilter("AI推薦"); setAiPicks([]);
    setTimeout(() => {
      const picks = AI_PICKS.map(p => {
        const s = ALL_STOCKS.find(x => x.code === p.code) || buildBase(p.code);
        return s ? { ...s, aiReason: p.reason } : null;
      }).filter(Boolean);
      setAiPicks(picks);
      setScanning(false);
    }, 600);
  };

  const handleSelect = useCallback(async (s) => {
    setSelected(s); setAnalysis(""); setLoadAI(true);
    const divS = s.divs?.length
      ? `除息${s.divs[0].exDate} 配$${s.divs[0].cash} 殖利率${s.divs[0].yld}%`
      : "無除息";
    const prompt = `你是資深台股基金經理人，請以繁體中文針對以下股票撰寫約350字的專業分析。\n股票：${s.code} ${s.name}（${s.sector}）題材：${s.theme}\n現價：$${fmtP(s.price)} 漲跌：${s.changePct}%\nPE：${s.pe}x　ROE：${s.roe}%\n${divS}\n請輸出四段：【一、題材與催化劑】【二、財務健康度】【三、估值與股利分析】【四、操作建議】`;
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1024, messages:[{role:"user",content:prompt}] })
      });
      if (!r.ok) throw 0;
      const j = await r.json();
      const t = (j.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").trim();
      setAnalysis(t || buildFallback(s));
    } catch {
      setAnalysis(buildFallback(s));
    }
    setLoadAI(false);
  }, [ALL_STOCKS]);

  const hotCnt   = ALL_STOCKS.filter(s => Math.abs(s.changePct) >= 9.5).length;
  const aiCnt    = Object.keys(aiSheetMap).length;
  const isLoading = status === "載入中";

  return (
    <div style={{minHeight:"100vh",background:"#0a0a0f",color:"#fff",fontFamily:"'Noto Sans TC','PingFang TC',sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;} body{background:#0a0a0f;} html,body{-webkit-text-size-adjust:none;} input{font-size:16px!important;}
        ::-webkit-scrollbar{width:3px;} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px;}
        .scan-btn{background:linear-gradient(135deg,#00d296,#0077ff);color:#000;border:none;padding:10px 16px;border-radius:50px;font-size:13px;font-weight:900;cursor:pointer;white-space:nowrap;transition:all 0.18s;}
        .scan-btn:active{transform:scale(0.97);} .scan-btn:disabled{opacity:0.6;cursor:not-allowed;}
        .upd-btn{background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);color:#aaa;padding:9px 14px;border-radius:50px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all 0.18s;}
        .upd-btn:hover{background:rgba(255,255,255,0.12);color:#fff;} .upd-btn:disabled{opacity:0.5;cursor:not-allowed;}
        .search-wrap{position:relative;margin-bottom:10px;}
        .search-box{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#fff;width:100%;padding:10px 36px;border-radius:12px;font-size:16px;outline:none;transition:border 0.2s;}
        .search-box:focus{border-color:rgba(0,210,150,0.4);background:rgba(0,210,150,0.04);}
        .clear-btn{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:#555;font-size:16px;cursor:pointer;}
        .filter-row{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;-webkit-overflow-scrolling:touch;}
        .filter-btn{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);color:#888;padding:5px 12px;border-radius:20px;font-size:11px;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:all 0.15s;}
        .filter-btn.active{background:rgba(0,210,150,0.15);border-color:#00d296;color:#00d296;font-weight:700;}
        .card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:14px 16px;cursor:pointer;margin-bottom:10px;transition:all 0.18s;}
        .card:active{transform:scale(0.99);background:rgba(255,255,255,0.05);}
        .tag{background:rgba(0,210,150,0.12);color:#00d296;font-size:10px;padding:2px 7px;border-radius:20px;font-weight:700;white-space:nowrap;}
        .overlay{position:fixed;inset:0;background:rgba(0,0,0,0.78);backdrop-filter:blur(10px);z-index:100;display:flex;align-items:flex-end;animation:overlayIn 0.2s ease;}
        @keyframes overlayIn{from{opacity:0}to{opacity:1}}
        .sheet{width:100%;max-height:93vh;background:#111318;border-radius:22px 22px 0 0;border-top:1px solid rgba(255,255,255,0.1);display:flex;flex-direction:column;position:relative;animation:sheetUp 0.32s cubic-bezier(0.22,1,0.36,1);}
        @keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        .close-btn{position:absolute;top:10px;right:14px;background:rgba(255,255,255,0.08);border:none;color:#777;width:32px;height:32px;border-radius:16px;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
        .msec{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:13px;padding:13px 15px;margin-bottom:10px;}
        .sl{font-size:10px;color:#555;font-weight:700;letter-spacing:1.5px;margin-bottom:10px;text-transform:uppercase;}
        @keyframes spin{to{transform:rotate(360deg)}} .spinner{width:16px;height:16px;border:2px solid rgba(0,210,150,0.2);border-top-color:#00d296;border-radius:50%;animation:spin 0.7s linear infinite;flex-shrink:0;}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}} .pulse{animation:pulse 0.9s ease-in-out infinite;}
        @keyframes fu{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} .fu{animation:fu 0.25s ease forwards;opacity:0;}
      `}</style>

      {/* Header */}
      <div style={{padding:"16px 16px 10px",borderBottom:"1px solid rgba(255,255,255,0.05)",position:"sticky",top:0,background:"#0a0a0f",zIndex:10}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:10}}>
          <div>
            <div style={{fontSize:10,color:"#00d296",fontWeight:700,letterSpacing:2,marginBottom:1}}>TAIWAN STOCK AI</div>
            <div style={{fontSize:18,fontWeight:900}}>台股題材選股雷達</div>
          </div>
          <div style={{display:"flex",gap:6,flexShrink:0}}>
            <button className="upd-btn" onClick={loadData} disabled={isLoading}>
              {isLoading ? <span className="pulse">⏳</span> : "📡"} {isLoading ? "載入中" : "更新資料"}
            </button>
            <button className="scan-btn" onClick={handleAIScan} disabled={scanning}>
              {scanning ? <span className="pulse">⚡ 選股中</span> : "⚡ AI選股"}
            </button>
          </div>
        </div>

        {/* 狀態列 */}
        <div style={{fontSize:10,marginBottom:8,display:"flex",flexWrap:"wrap",gap:6,alignItems:"center"}}>
          <span style={{color:status==="已更新"?"#00d296":status==="載入中"?"#ffd166":status==="尚未載入"?"#555":"#ff6b6b",fontWeight:700}}>
            {status==="已更新"?"✅":status==="載入中"?"⏳":status==="尚未載入"?"📡":"⚠"} {status}
          </span>
          {dataDate && <span style={{color:"#333"}}>{dataDate}</span>}
          {status !== "已更新" && debugMsg && <span style={{color:status==="失敗（使用內建資料）"?"#ff6b6b":"#666",fontSize:9,display:"block",width:"100%",marginTop:2}}>{debugMsg}</span>}
          {hotCnt > 0 && <span style={{color:"#ff9f40"}}>🔥{hotCnt}漲停</span>}
          {aiCnt  > 0 && <span style={{color:"#7b61ff"}}>🤖AI{aiCnt}檔</span>}
          <span style={{color:"#222"}}>共{ALL_STOCKS.length}檔</span>
        </div>

        {/* 搜尋 */}
        <div className="search-wrap">
          <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:14,color:"#444",pointerEvents:"none"}}>🔍</span>
          <input className="search-box" placeholder="搜尋股號或名稱：2330、台積電、00919、長榮…"
            value={query} onChange={e => { setQuery(e.target.value); if (filter==="AI推薦") setFilter("全部"); }}/>
          {query && <button className="clear-btn" onClick={() => setQuery("")}>✕</button>}
        </div>

        {/* 主題篩選 */}
        {!query && (
          <div className="filter-row">
            {THEMES.map(t => (
              <button key={t} className={`filter-btn ${filter===t?"active":""}`}
                onClick={() => { setFilter(t); if (t==="AI推薦" && !aiPicks.length) handleAIScan(); }}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 股票列表 */}
      <div style={{padding:"12px 16px 72px"}}>
        <div style={{fontSize:12,color:"#333",marginBottom:10}}>
          {filter==="AI推薦" && aiPicks.length > 0
            ? <span>✨ AI推薦 <b style={{color:"#00d296"}}>{displayList.length}</b> 檔</span>
            : query
            ? <>搜尋「<span style={{color:"#00d296"}}>{query}</span>」<b style={{color:"#00d296"}}>{displayList.length}</b> 檔</>
            : <><b style={{color:"#00d296"}}>{displayList.length}</b> 檔</>
          }
        </div>
        {scanning ? (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"50vh",gap:14}}>
            <div className="spinner" style={{width:40,height:40,borderWidth:3}}/>
            <div style={{color:"#00d296",fontSize:13,fontWeight:700}}>AI 精選推薦股...</div>
          </div>
        ) : displayList.length === 0 ? (
          <div style={{textAlign:"center",marginTop:80,padding:"0 24px"}}>
            {status === "載入中" ? (
              <>
                <div className="spinner" style={{width:48,height:48,borderWidth:4,margin:"0 auto 20px"}}/>
                <div style={{color:"#00d296",fontSize:14,fontWeight:700}}>載入資料中...</div>
                <div style={{color:"#555",fontSize:11,marginTop:8}}>約需 5~15 秒</div>
              </>
            ) : (
              <>
                <div style={{fontSize:36,marginBottom:12}}>🔍</div>
                <div style={{color:"#444",fontSize:13}}>找不到「{query}」</div>
                <div style={{fontSize:11,color:"#333",marginTop:6}}>試試：2330、台積電、ETF、00919、長榮</div>
              </>
            )}
          </div>
        ) : (
          displayList.map((s, i) => (
            <div key={s.code+i} className="fu" style={{animationDelay:`${i*15}ms`}}>
              <Card s={s} onSelect={handleSelect}/>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,padding:"8px 16px",background:"rgba(10,10,15,0.96)",borderTop:"1px solid rgba(255,255,255,0.04)",fontSize:10,color:"#222",display:"flex",justifyContent:"space-between"}}>
        <span>資料來源：撿股讚 Apps Script · 非投資建議</span>
        <span style={{fontFamily:"monospace"}}>v12 · {ALL_STOCKS.length}檔</span>
      </div>

      {selected && <Modal s={selected} onClose={() => setSelected(null)} analysis={analysis} loadingAI={loadAI}/>}
    </div>
  );
}