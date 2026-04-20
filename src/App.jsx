import { useState, useMemo, useCallback, useEffect, useRef } from "react";

// ══════════════════════════════════════════════════════════════
// 設定
// ══════════════════════════════════════════════════════════════
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwU0_YUmfNjq8dR5Nnng_mD3FDPkhTX1O4nZMt8QzYFcu9GfWI08nuqukhkwXLiyTgxAw/exec";

// ── JSONP ──────────────────────────────────────────────────────
function fetchJSONP(url) {
  return new Promise((resolve, reject) => {
    const cb = "__cb_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    const timer = setTimeout(() => { cleanup(); reject(new Error("JSONP timeout")); }, 30000);
    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      if (script.parentNode) script.parentNode.removeChild(script);
    }
    window[cb] = (data) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error("JSONP error")); };
    script.src = url + (url.includes("?") ? "&" : "?") + "callback=" + cb;
    document.head.appendChild(script);
  });
}

async function fetchSheets() {
  try {
    const data = await fetchJSONP(WEB_APP_URL);
    return data;
  } catch {
    // 嘗試 fetch 模式
    const res = await fetch(WEB_APP_URL);
    const text = await res.text();
    const m = text.match(/^[^(]+\((.+)\);?\s*$/s);
    return JSON.parse(m ? m[1] : text);
  }
}

// ── 格式化工具 ─────────────────────────────────────────────────
const fmtP = (v) => {
  const n = parseFloat(String(v || "").replace(/[^0-9.-]/g, ""));
  if (isNaN(n)) return v || "─";
  return n.toLocaleString("zh-TW", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};
const fmtPct = (v) => {
  const n = parseFloat(String(v || "").replace(/[^0-9.-]/g, ""));
  if (isNaN(n)) return v || "─";
  const c = n >= 0 ? "#e53935" : "#43a047";
  return <span style={{ color: c }}>{n >= 0 ? "+" : ""}{n.toFixed(2)}%</span>;
};

// ── 題材猜測 ───────────────────────────────────────────────────
const THEMES = [
  { id: "all",   label: "📋 全部",    keywords: [] },
  { id: "semi",  label: "💾 半導體",  keywords: ["半導體","積電","聯電","矽","晶圓"] },
  { id: "ai",    label: "🤖 AI/伺服", keywords: ["AI","伺服","雲端","算力","輝達"] },
  { id: "fin",   label: "🏦 金融",    keywords: ["金控","銀行","保險","證券","金融"] },
  { id: "ship",  label: "🚢 航運",    keywords: ["航運","海運","貨櫃","長榮","陽明"] },
  { id: "bio",   label: "💊 生技",    keywords: ["生技","醫療","製藥","醫"] },
  { id: "etf",   label: "📊 ETF",     keywords: ["ETF","00"] },
  { id: "food",  label: "🍜 食品",    keywords: ["食品","統一","飲料","農"] },
  { id: "elec",  label: "⚡ 電子",    keywords: ["電子","科技","光電","面板"] },
  { id: "build", label: "🏗️ 營建",    keywords: ["建設","建築","地產","營建"] },
];

function guessSector(code, name) {
  const n = (name || "").toLowerCase();
  if (code && code.startsWith("00")) return "ETF";
  if (n.includes("積電")||n.includes("聯電")||n.includes("半導")) return "半導體";
  if (n.includes("金控")||n.includes("銀行")||n.includes("金融")) return "金融";
  if (n.includes("航運")||n.includes("海運")) return "航運";
  if (n.includes("生技")||n.includes("醫療")||n.includes("製藥")) return "生技醫療";
  if (n.includes("建設")||n.includes("建築")||n.includes("地產")) return "營建";
  if (n.includes("食品")||n.includes("統一")||n.includes("飲料")) return "食品";
  if (n.includes("光電")||n.includes("面板")) return "光電";
  return "電子/其他";
}

// ══════════════════════════════════════════════════════════════
// 樣式
// ══════════════════════════════════════════════════════════════
const S = {
  app: {
    display: "flex", height: "100vh", overflow: "hidden",
    background: "#0d1117", color: "#e6edf3",
    fontFamily: "'Noto Sans TC', 'PingFang TC', sans-serif",
    fontSize: 14,
  },
  // ── 側邊欄 ──
  sidebar: (open) => ({
    width: open ? 220 : 52,
    minWidth: open ? 220 : 52,
    background: "#161b22",
    borderRight: "1px solid #30363d",
    display: "flex", flexDirection: "column",
    transition: "width 0.25s cubic-bezier(.4,0,.2,1)",
    overflow: "hidden", flexShrink: 0, zIndex: 10,
  }),
  sidebarHeader: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "14px 12px", borderBottom: "1px solid #30363d",
    minHeight: 52, flexShrink: 0,
  },
  toggleBtn: {
    background: "none", border: "none", color: "#8b949e",
    cursor: "pointer", padding: 4, borderRadius: 6, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 18, lineHeight: 1,
    transition: "color 0.15s",
  },
  sidebarTitle: {
    fontSize: 13, fontWeight: 700, color: "#58a6ff",
    whiteSpace: "nowrap", overflow: "hidden",
  },
  navSection: {
    padding: "8px 0", borderBottom: "1px solid #21262d",
  },
  navLabel: {
    fontSize: 10, color: "#8b949e", fontWeight: 600,
    padding: "4px 16px", letterSpacing: 1,
    whiteSpace: "nowrap", overflow: "hidden",
  },
  navItem: (active) => ({
    display: "flex", alignItems: "center", gap: 10,
    padding: "9px 12px", cursor: "pointer",
    background: active ? "#21262d" : "transparent",
    borderLeft: active ? "3px solid #58a6ff" : "3px solid transparent",
    color: active ? "#e6edf3" : "#8b949e",
    transition: "all 0.15s",
    whiteSpace: "nowrap", overflow: "hidden",
    userSelect: "none",
  }),
  navIcon: { fontSize: 18, flexShrink: 0, width: 24, textAlign: "center" },
  navText: { fontSize: 13, overflow: "hidden", textOverflow: "ellipsis" },
  // ── 主區 ──
  main: {
    flex: 1, display: "flex", flexDirection: "column", overflow: "hidden",
  },
  topbar: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "10px 16px", borderBottom: "1px solid #30363d",
    background: "#161b22", flexShrink: 0,
  },
  searchInput: {
    flex: 1, background: "#0d1117", border: "1px solid #30363d",
    borderRadius: 8, padding: "7px 12px", color: "#e6edf3",
    fontSize: 14, outline: "none",
  },
  refreshBtn: {
    background: "#21262d", border: "1px solid #30363d",
    color: "#58a6ff", borderRadius: 8, padding: "7px 14px",
    cursor: "pointer", fontSize: 13, fontWeight: 600,
    whiteSpace: "nowrap", flexShrink: 0,
  },
  statusBar: {
    fontSize: 11, color: "#8b949e", padding: "4px 16px",
    background: "#0d1117", borderBottom: "1px solid #21262d",
    flexShrink: 0,
  },
  content: {
    flex: 1, overflow: "auto", padding: 16,
  },
  // ── 股票卡 ──
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
    gap: 12,
  },
  card: (score) => ({
    background: score >= 9 ? "#1c2a1c" : score >= 7 ? "#161b22" : "#161b22",
    border: `1px solid ${score >= 9 ? "#2ea043" : score >= 7 ? "#30363d" : "#30363d"}`,
    borderRadius: 10, padding: "14px 16px", cursor: "pointer",
    transition: "all 0.15s", position: "relative",
  }),
  cardCode: { fontSize: 11, color: "#8b949e", fontFamily: "monospace" },
  cardName: { fontSize: 16, fontWeight: 700, color: "#e6edf3", marginTop: 2 },
  cardSector: {
    display: "inline-block", fontSize: 10, color: "#58a6ff",
    background: "#1f2d3d", borderRadius: 4, padding: "2px 6px",
    marginTop: 4,
  },
  cardPrice: { fontSize: 22, fontWeight: 800, color: "#f0f6fc", marginTop: 8 },
  cardRow: { display: "flex", gap: 16, marginTop: 6, flexWrap: "wrap" },
  cardStat: { display: "flex", flexDirection: "column" },
  cardStatLabel: { fontSize: 10, color: "#8b949e" },
  cardStatVal: { fontSize: 13, fontWeight: 600, color: "#e6edf3" },
  scoreBadge: (s) => ({
    position: "absolute", top: 12, right: 12,
    background: s >= 9 ? "#2ea043" : s >= 7 ? "#1f6feb" : s >= 5 ? "#6e7681" : "#b91c1c",
    color: "#fff", borderRadius: 6, padding: "2px 8px",
    fontSize: 12, fontWeight: 700,
  }),
  // ── 表格（IPO & 紀念品）──
  tableWrap: { overflowX: "auto" },
  table: {
    width: "100%", borderCollapse: "collapse", fontSize: 13,
  },
  th: {
    background: "#161b22", color: "#8b949e", fontWeight: 600,
    padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #30363d",
    whiteSpace: "nowrap", position: "sticky", top: 0,
  },
  td: (bg) => ({
    padding: "9px 12px", borderBottom: "1px solid #21262d",
    background: bg || "transparent", whiteSpace: "nowrap",
  }),
  // ── Modal ──
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,.75)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 100, padding: 16,
  },
  modal: {
    background: "#161b22", border: "1px solid #30363d",
    borderRadius: 14, padding: 24, width: "100%", maxWidth: 560,
    maxHeight: "90vh", overflowY: "auto",
    position: "relative",
  },
  closeBtn: {
    position: "absolute", top: 14, right: 14,
    background: "#21262d", border: "none", color: "#8b949e",
    borderRadius: 8, width: 28, height: 28, cursor: "pointer",
    fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
  },
  aiBox: {
    background: "#0d1117", borderRadius: 10, padding: "14px 16px",
    marginTop: 14, border: "1px solid #30363d", lineHeight: 1.7,
    fontSize: 13, color: "#c9d1d9", whiteSpace: "pre-wrap",
    maxHeight: 380, overflowY: "auto",
  },
};

// ══════════════════════════════════════════════════════════════
// Modal 個股分析
// ══════════════════════════════════════════════════════════════
function StockModal({ stock, onClose, onAnalyze, analyzing, aiText }) {
  if (!stock) return null;
  const s = stock;
  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        <button style={S.closeBtn} onClick={onClose}>✕</button>
        <div style={S.cardCode}>{s.code}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#f0f6fc", marginTop: 2 }}>{s.name}</div>
        <div style={S.cardSector}>{s.sector}</div>

        {/* 價格區 */}
        <div style={{ display: "flex", gap: 20, marginTop: 14, flexWrap: "wrap" }}>
          {[
            ["股價", s.price ? `$${fmtP(s.price)}` : "─"],
            ["漲跌幅", s.change || "─"],
            ["本益比", s.pe || "─"],
            ["殖利率", s.yld ? `${s.yld}%` : "─"],
            ["去年EPS", s.eps ? `$${s.eps}` : "─"],
            ["現金配息", s.cash ? `$${s.cash}` : "─"],
          ].map(([l, v]) => (
            <div key={l} style={S.cardStat}>
              <span style={S.cardStatLabel}>{l}</span>
              <span style={{ ...S.cardStatVal, fontSize: 15 }}>
                {l === "漲跌幅" ? fmtPct(v) : v}
              </span>
            </div>
          ))}
        </div>

        {/* AI分析摘要 */}
        {s.aiComment && (
          <div style={{ marginTop: 14, padding: "10px 14px", background: "#0d1117", borderRadius: 8, border: "1px solid #30363d" }}>
            <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>📊 AI 綜合評分 {s.aiScore} / 10</div>
            <div style={{ fontSize: 13, color: "#c9d1d9" }}>{s.aiComment}</div>
            {s.aiAdv && <div style={{ fontSize: 12, color: "#2ea043", marginTop: 6 }}>✅ {s.aiAdv}</div>}
            {s.aiRisk && <div style={{ fontSize: 12, color: "#f85149", marginTop: 3 }}>⚠️ {s.aiRisk}</div>}
          </div>
        )}

        {/* Claude 深度分析 */}
        <button
          onClick={() => onAnalyze(s)}
          disabled={analyzing}
          style={{
            marginTop: 16, width: "100%", padding: "11px 0",
            background: analyzing ? "#21262d" : "#1f6feb",
            color: "#fff", border: "none", borderRadius: 8,
            fontSize: 14, fontWeight: 700, cursor: analyzing ? "wait" : "pointer",
          }}
        >
          {analyzing ? "⏳ 分析中..." : "🤖 Claude 深度分析"}
        </button>
        {aiText && <div style={S.aiBox}>{aiText}</div>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 主畫面：股票選股
// ══════════════════════════════════════════════════════════════
function StockView({ stocks, loading, status }) {
  const [search, setSearch] = useState("");
  const [theme, setTheme] = useState("all");
  const [selected, setSelected] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiText, setAiText] = useState("");

  const filtered = useMemo(() => {
    let list = stocks;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(s =>
        s.code.includes(q) || s.name.toLowerCase().includes(q) ||
        (s.sector || "").toLowerCase().includes(q)
      );
    }
    if (theme !== "all") {
      const t = THEMES.find(t => t.id === theme);
      if (t && t.keywords.length) {
        list = list.filter(s =>
          t.keywords.some(kw =>
            s.name.includes(kw) || (s.sector || "").includes(kw) || s.code.includes(kw)
          )
        );
      }
    }
    return list;
  }, [stocks, search, theme]);

  const analyze = useCallback(async (s) => {
    setAnalyzing(true);
    setAiText("");
    const prompt = `你是專業台股分析師，請針對以下個股給出300字以內的專業分析（繁體中文）：
股票代號：${s.code} ${s.name}
現股價：${s.price}，今日漲跌：${s.change}
本益比：${s.pe}，殖利率：${s.yld}%，去年EPS：${s.eps}
現金配息：${s.cash}，除息日：${s.exDivDate}
10年配息次數：${s.cnt10y}，3年均利：${s.avg3y}，10年均利：${s.avg10y}
AI評分：${s.aiScore}/10
主要優勢：${s.aiAdv || "─"}
主要風險：${s.aiRisk || "─"}

請從：①基本面 ②估值是否合理 ③配息穩定性 ④近期題材催化劑 ⑤操作建議 五個面向分析。`;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": "", "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 600,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const d = await res.json();
      setAiText(d.content?.[0]?.text || "無法取得分析");
    } catch {
      setAiText("⚠️ 分析服務暫時無法連線，請確認網路。");
    }
    setAnalyzing(false);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* 搜尋 */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #21262d", flexShrink: 0 }}>
        <input
          style={S.searchInput}
          placeholder="搜尋代號、名稱..."
          value={search} onChange={e => setSearch(e.target.value)}
        />
        {/* 題材篩選 */}
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          {THEMES.map(t => (
            <button key={t.id}
              onClick={() => setTheme(t.id)}
              style={{
                background: theme === t.id ? "#1f6feb" : "#21262d",
                border: "1px solid " + (theme === t.id ? "#58a6ff" : "#30363d"),
                color: theme === t.id ? "#fff" : "#8b949e",
                borderRadius: 6, padding: "5px 10px", cursor: "pointer",
                fontSize: 12, fontWeight: theme === t.id ? 700 : 400,
              }}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {/* 狀態 */}
      <div style={S.statusBar}>
        {loading ? "⏳ 資料載入中..." : `${status} | 顯示 ${filtered.length} / ${stocks.length} 筆`}
      </div>

      {/* 卡片 */}
      <div style={{ ...S.content }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "#8b949e", paddingTop: 60 }}>載入中…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", color: "#8b949e", paddingTop: 60 }}>找不到符合的股票</div>
        ) : (
          <div style={S.grid}>
            {filtered.map(s => {
              const score = parseInt(s.aiScore) || 0;
              return (
                <div key={s.code} style={S.card(score)}
                  onClick={() => { setSelected(s); setAiText(""); }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#58a6ff"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = score >= 9 ? "#2ea043" : "#30363d"; e.currentTarget.style.transform = ""; }}
                >
                  <div style={S.scoreBadge(score)}>{score}</div>
                  <div style={S.cardCode}>{s.code}</div>
                  <div style={S.cardName}>{s.name}</div>
                  <div style={S.cardSector}>{s.sector}</div>
                  <div style={S.cardPrice}>${fmtP(s.price) || "─"}</div>
                  <div style={S.cardRow}>
                    <div style={S.cardStat}>
                      <span style={S.cardStatLabel}>漲跌幅</span>
                      <span style={S.cardStatVal}>{fmtPct(s.change)}</span>
                    </div>
                    <div style={S.cardStat}>
                      <span style={S.cardStatLabel}>殖利率</span>
                      <span style={S.cardStatVal}>{s.yld ? s.yld + "%" : "─"}</span>
                    </div>
                    <div style={S.cardStat}>
                      <span style={S.cardStatLabel}>本益比</span>
                      <span style={S.cardStatVal}>{s.pe || "─"}</span>
                    </div>
                    <div style={S.cardStat}>
                      <span style={S.cardStatLabel}>EPS</span>
                      <span style={S.cardStatVal}>{s.eps ? "$" + s.eps : "─"}</span>
                    </div>
                  </div>
                  {s.exDivDate && (
                    <div style={{ marginTop: 8, fontSize: 11, color: "#f0883e" }}>
                      📅 除息日 {s.exDivDate}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <StockModal
          stock={selected} onClose={() => setSelected(null)}
          onAnalyze={analyze} analyzing={analyzing} aiText={aiText}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 新股申購頁
// ══════════════════════════════════════════════════════════════
function IPOView({ ipoData, loading, status }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search.trim()) return ipoData;
    const q = search.trim().toLowerCase();
    return ipoData.filter(r =>
      (r["股票代號"] || "").includes(q) ||
      (r["公司名稱"] || "").toLowerCase().includes(q) ||
      (r["發行市場"] || "").includes(q)
    );
  }, [ipoData, search]);

  const cols = ["抽籤日期","股票代號","公司名稱","發行市場","申購起日","申購迄日","撥券日期","承銷張數","承銷價","收盤價","報酬率%","每張賺賠(元)","申購張數","需備資金(元)","總合格件數","中籤率%"];

  const rowBg = (row) => {
    const drawDate = row["抽籤日期"] || "";
    const roi = parseFloat(String(row["報酬率%"] || "0").replace(/[^0-9.-]/g, "")) || 0;
    const today = new Date();
    try {
      const p = drawDate.split("/");
      if (p.length === 3) {
        const d = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
        if (d > today) return "#1c2a3a"; // 未抽籤 藍
      }
    } catch { /* */ }
    if (roi >= 100) return "#1c2a1c"; // 超高報酬 綠
    if (roi >= 30) return "#192019";
    if (roi < 0) return "#2a1c1c";   // 虧損 紅
    return undefined;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #21262d", flexShrink: 0 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#f0f6fc", marginBottom: 10 }}>🎲 新股申購專區</div>
        <input style={S.searchInput} placeholder="搜尋代號、公司、市場..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div style={S.statusBar}>
        {loading ? "⏳ 資料載入中..." : `${status} | 共 ${filtered.length} 筆　🔵=尚未抽籤　🟢=高報酬　🔴=虧損`}
      </div>
      <div style={S.content}>
        {loading ? (
          <div style={{ textAlign: "center", color: "#8b949e", paddingTop: 60 }}>載入中…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", color: "#8b949e", paddingTop: 60 }}>暫無資料</div>
        ) : (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>{cols.map(c => <th key={c} style={S.th}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const bg = rowBg(row);
                  const roi = parseFloat(String(row["報酬率%"] || "0").replace(/[^0-9.-]/g, "")) || 0;
                  return (
                    <tr key={i}>
                      {cols.map(c => {
                        let val = row[c] || "─";
                        let extra = {};
                        if (c === "報酬率%") {
                          extra.color = roi >= 0 ? "#2ea043" : "#f85149";
                          extra.fontWeight = 700;
                          if (roi > 0) val = "+" + val;
                        }
                        if (c === "每張賺賠(元)") {
                          const n = parseFloat(String(val).replace(/[^0-9.-]/g, ""));
                          extra.color = n >= 0 ? "#2ea043" : "#f85149";
                        }
                        if (c === "股票代號") {
                          extra.fontFamily = "monospace";
                          extra.color = "#58a6ff";
                        }
                        return <td key={c} style={{ ...S.td(bg), ...extra }}>{val}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 股東會紀念品頁
// ══════════════════════════════════════════════════════════════
function GiftView({ giftData, loading, status }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search.trim()) return giftData;
    const q = search.trim().toLowerCase();
    return giftData.filter(r =>
      (r["股票代號"] || "").includes(q) ||
      (r["公司名稱"] || "").toLowerCase().includes(q) ||
      (r["紀念品"] || "").toLowerCase().includes(q) ||
      (r["開會地點"] || "").includes(q)
    );
  }, [giftData, search]);

  const cols = ["序號","股票代號","公司名稱","股價","紀念品","開會日期","開會地點","最後買進日","股務代理","股代電話","零股寄單","是否改選"];

  // 判斷是否快到最後買進日
  const urgency = (row) => {
    const ld = row["最後買進日"] || "";
    if (!ld || ld === "─") return null;
    try {
      const today = new Date();
      // 格式可能是 MM.DD 或 YYYY/MM/DD
      let target;
      if (ld.includes("/")) {
        const p = ld.split("/");
        target = new Date(parseInt(p[0]) < 1911 ? parseInt(p[0]) + 1911 : parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
      } else if (ld.includes(".")) {
        const p = ld.split(".");
        target = new Date(today.getFullYear(), parseInt(p[0]) - 1, parseInt(p[1]));
        if (target < today) target.setFullYear(target.getFullYear() + 1);
      }
      if (!target) return null;
      const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
      return diff;
    } catch { return null; }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #21262d", flexShrink: 0 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#f0f6fc", marginBottom: 10 }}>🎁 股東會紀念品專區</div>
        <input style={S.searchInput} placeholder="搜尋代號、公司、紀念品、地點..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div style={S.statusBar}>
        {loading ? "⏳ 資料載入中..." : `${status} | 共 ${filtered.length} 筆　🔴=最後買進日≤7天　🟡=≤14天`}
      </div>
      <div style={S.content}>
        {loading ? (
          <div style={{ textAlign: "center", color: "#8b949e", paddingTop: 60 }}>載入中…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", color: "#8b949e", paddingTop: 60 }}>暫無資料</div>
        ) : (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>{cols.map(c => <th key={c} style={S.th}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const days = urgency(row);
                  const bg = days !== null
                    ? days <= 7 ? "#2a1c1c"
                    : days <= 14 ? "#2a2011"
                    : undefined
                    : undefined;
                  return (
                    <tr key={i}>
                      {cols.map(c => {
                        let val = row[c] || "─";
                        let extra = {};
                        if (c === "紀念品") { extra.color = "#f0f6fc"; extra.fontWeight = 600; }
                        if (c === "最後買進日" && days !== null) {
                          extra.color = days <= 7 ? "#f85149" : days <= 14 ? "#f0883e" : "#2ea043";
                          extra.fontWeight = 700;
                          val = val + (days >= 0 ? ` (${days}天)` : " (已過)");
                        }
                        if (c === "股票代號") { extra.fontFamily = "monospace"; extra.color = "#58a6ff"; }
                        return <td key={c} style={{ ...S.td(bg), ...extra }}>{val}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// App 根元件
// ══════════════════════════════════════════════════════════════
const NAV = [
  {
    section: "主功能",
    items: [
      { id: "stocks", icon: "📈", label: "選股雷達" },
    ]
  },
  {
    section: "專區",
    items: [
      { id: "ipo",  icon: "🎲", label: "新股申購專區" },
      { id: "gift", icon: "🎁", label: "股東會紀念品" },
    ]
  },
];

export default function App() {
  const [sideOpen, setSideOpen] = useState(true);
  const [page, setPage] = useState("stocks");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("尚未載入");
  const [stocks, setStocks] = useState([]);
  const [ipoData, setIpoData] = useState([]);
  const [giftData, setGiftData] = useState([]);
  const loadedRef = useRef(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setStatus("連線中...");
    try {
      const data = await fetchSheets();
      // ── 整合 market + dividend + ai ──
      const marketMap = {};
      (data.market || []).forEach(r => {
        const code = String(r["股票代號"] || "").replace(/'/g, "").trim();
        if (code) marketMap[code] = r;
      });
      const divMap = {};
      (data.dividend || []).forEach(r => {
        const code = String(r["股票代號"] || "").replace(/'/g, "").trim();
        if (code) divMap[code] = r;
      });
      const aiMap = {};
      (data.ai || []).forEach(r => {
        const code = String(r["股票代號"] || "").replace(/'/g, "").trim();
        if (code) aiMap[code] = r;
      });

      const allCodes = new Set([...Object.keys(marketMap), ...Object.keys(divMap), ...Object.keys(aiMap)]);
      const merged = [];
      allCodes.forEach(code => {
        const m = marketMap[code] || {};
        const d = divMap[code] || {};
        const a = aiMap[code] || {};
        const name = a["公司名稱"] || d["公司名稱"] || m["公司名稱"] || "";
        merged.push({
          code,
          name,
          sector: a["題材/產業"] || guessSector(code, name),
          price:  m["股價"] || a["股價"] || "",
          change: m["漲跌幅%"] || a["今日漲跌%"] || "",
          pe:     m["本益比"] || a["本益比"] || "",
          yld:    d["現金殖利率%"] || a["殖利率%"] || "",
          eps:    d["去年EPS"] || a["去年EPS"] || "",
          cash:   d["現金配息"] || a["現金配息"] || "",
          exDivDate: d["除息日"] || a["除息日"] || "",
          cnt10y: d["10年配息次數"] || a["10年配息次數"] || "",
          avg3y:  d["3年平均股利"] || a["3年均利"] || "",
          avg10y: d["10年平均股利"] || a["10年均利"] || "",
          aiScore:   a["AI綜合評分"] || "",
          aiComment: a["AI評語"] || "",
          aiAdv:     a["主要優勢"] || "",
          aiRisk:    a["主要風險"] || "",
          mgmtScore: a["管理層評分"] || "",
          mgmtLabel: a["管理層評級"] || "",
        });
      });
      merged.sort((a, b) => (parseInt(b.aiScore) || 0) - (parseInt(a.aiScore) || 0));
      setStocks(merged);

      // ── IPO ──
      setIpoData(data.ipo || []);

      // ── Gift ──
      setGiftData(data.gift || []);

      setStatus(`更新：${data.updatedAt || new Date().toLocaleString("zh-TW")}`);
    } catch (e) {
      setStatus("❌ 載入失敗：" + e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!loadedRef.current) { loadedRef.current = true; loadData(); }
  }, [loadData]);

  // 找出當前 page 資訊
  const allNavItems = NAV.flatMap(s => s.items);
  const currentItem = allNavItems.find(i => i.id === page);

  return (
    <div style={S.app}>
      {/* ── 側邊欄 ── */}
      <div style={S.sidebar(sideOpen)}>
        {/* 標題列 */}
        <div style={S.sidebarHeader}>
          <button style={S.toggleBtn} onClick={() => setSideOpen(o => !o)} title="收合選單">
            {sideOpen ? "◀" : "▶"}
          </button>
          {sideOpen && <span style={S.sidebarTitle}>台股選股雷達</span>}
        </div>

        {/* 導覽項目 */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
          {NAV.map(section => (
            <div key={section.section} style={S.navSection}>
              {sideOpen && <div style={S.navLabel}>{section.section}</div>}
              {section.items.map(item => (
                <div key={item.id}
                  style={S.navItem(page === item.id)}
                  onClick={() => setPage(item.id)}
                >
                  <span style={S.navIcon}>{item.icon}</span>
                  {sideOpen && <span style={S.navText}>{item.label}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* 底部重新整理 */}
        <div style={{ padding: "10px 8px", borderTop: "1px solid #30363d", flexShrink: 0 }}>
          <button
            onClick={loadData}
            style={{
              width: sideOpen ? "100%" : 36, height: 36,
              background: "#1f6feb", border: "none",
              color: "#fff", borderRadius: 8,
              cursor: "pointer", fontSize: sideOpen ? 13 : 18,
              fontWeight: 700, display: "flex",
              alignItems: "center", justifyContent: "center", gap: 6,
              transition: "width 0.25s",
            }}
            disabled={loading}
          >
            <span>{loading ? "⏳" : "🔄"}</span>
            {sideOpen && <span>{loading ? "載入中" : "更新資料"}</span>}
          </button>
        </div>
      </div>

      {/* ── 主內容 ── */}
      <div style={S.main}>
        {/* 頂部標題列 */}
        <div style={S.topbar}>
          <span style={{ fontSize: 20, marginRight: 4 }}>{currentItem?.icon}</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: "#f0f6fc" }}>{currentItem?.label}</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "#8b949e" }}>{status}</span>
        </div>

        {/* 頁面內容 */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {page === "stocks" && (
            <StockView stocks={stocks} loading={loading} status={status} />
          )}
          {page === "ipo" && (
            <IPOView ipoData={ipoData} loading={loading} status={status} />
          )}
          {page === "gift" && (
            <GiftView giftData={giftData} loading={loading} status={status} />
          )}
        </div>
      </div>
    </div>
  );
}