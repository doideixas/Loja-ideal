import { useState, useEffect, useMemo, useCallback } from "react";

const SHEET_ID = "1uJMeTGgKZIEZqmTsnD5V3hLt6aBF5eSVIA80lWCP3zw";
const API_KEY  = "AIzaSyAkOM45l-ssDbG6wpZaZ1I6MKZDx_jvJlw";

async function fetchSheet(sheetName) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(sheetName)}?key=${API_KEY}`;
  const res  = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.values || [];
}

const SETORES_ALVO    = [121,122,123,124,125,126,127,128,321,322,421];
const EMBALAGENS_ALVO = ['088','187','032','022','131','062','154','020','068','141'];
const DIAS            = ["TODOS","SEG","TER","QUA","QUI","SEX","SAB"];
const DIAS_IDX        = {0:"SEG",1:"TER",2:"QUA",3:"QUI",4:"SEX",5:"SAB",6:"DOM"};
const getDiaHoje      = () => DIAS_IDX[new Date().getDay()] || "SEG";

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map(h => String(h).trim());
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = String(row[i] || "").trim(); });
    return obj;
  });
}

function parseLojaIdeal(rows) {
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some(v => ["Codigo","Código","CODIGO"].includes(String(v).trim()))) {
      headerIdx = i; break;
    }
  }
  if (headerIdx === -1) return [];
  const headers = rows[headerIdx].map(h => String(h).trim());
  return rows.slice(headerIdx + 1)
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = String(row[i] || "").trim(); });
      return obj;
    })
    .filter(r => r.Codigo && r.Codigo !== "");
}

function formatVal(colName, value) {
  const s = String(value || "").trim();
  if (!s || s === "nan" || s === "None" || s === "#N/A") return "";
  const col = colName.toLowerCase();
  if (col.includes("exec real") || col.includes("desaf gap")) {
    if (s.toUpperCase() === "OK") return "OK";
    if (s.toUpperCase() === "NMETA") return "NMeta";
    const f = parseFloat(s);
    if (!isNaN(f)) {
      if (f === 0) return "0%";
      // Sheets API retorna decimal (0.45 = 45%) — valores > 1 já são porcentagem inteira
      if (f > 1) return `${Math.round(f)}%`;
      return `${Math.round(f * 100)}%`;
    }
    return s;
  }
  if (s.endsWith(".0")) { const n = parseInt(s); if (!isNaN(n)) return String(n); }
  return s;
}

function gapNum(g) {
  const s = String(g || "").trim();
  if (!s || s.toUpperCase() === "OK") return null;
  const n = parseInt(s);
  return isNaN(n) ? null : n;
}

function calcSKUVender(cadRows, vndRows, estRows, diaFiltro) {
  let clientes = rowsToObjects(cadRows);
  clientes = clientes.filter(c => {
    const setor = parseInt(c["Cod. Setor"] || c["Cod.Setor"] || "");
    return SETORES_ALVO.includes(setor);
  });
  if (diaFiltro && diaFiltro !== "TODOS") {
    clientes = clientes.filter(c => {
      const vis = String(c["Frequencia Visita"] || c["Frequencia"] || "").trim().toUpperCase();
      return vis.startsWith(diaFiltro);
    });
  }

  const vendas = rowsToObjects(vndRows);
  const colCli = Object.keys(vendas[0] || {}).find(k => k.toLowerCase().includes("cliente")) || "Cliente";
  const historico = {};
  const gapSkuMap = {};
  vendas.forEach(v => {
    const cli  = String(v[colCli] || "").trim();
    const prod = String(v["Cod.Produto"] || v["CodProduto"] || "").trim();
    if (cli && prod) {
      if (!historico[cli]) historico[cli] = new Set();
      historico[cli].add(prod);
    }
    if (cli && v["Gap SKU"]) gapSkuMap[cli] = String(v["Gap SKU"]).trim();
  });

  let produtos = rowsToObjects(estRows);
  produtos = produtos.filter(p => {
    const tipo = String(p["Tipo de Produto"] || "").toLowerCase();
    const emb  = String(p["Embalagem"] || "").trim().slice(0, 3);
    const disp = parseFloat(p["Disp."] || p["Disponivel"] || "0");
    return tipo.includes("cerveja") && EMBALAGENS_ALVO.includes(emb) && disp > 0;
  });

  const rows = [];
  clientes.forEach(cli => {
    const codCli = String(cli["Codigo Cliente"] || cli["Código Cliente"] || "").trim();
    const gap    = gapSkuMap[codCli] || "";
    if (!gap || gap.toUpperCase() === "OK") return;
    const comprados = historico[codCli] || new Set();
    produtos.forEach(prod => {
      const codProd = String(prod["Cod"] || "").trim();
      if (!comprados.has(codProd)) {
        rows.push({
          "Cód.Cli":  codCli,
          "Fantasia": String(cli["Nome Fantasia"] || cli["Fantasia"] || "").trim().slice(0, 28),
          "Setor":    parseInt(cli["Cod. Setor"] || cli["Cod.Setor"] || "0"),
          "Visita":   String(cli["Frequencia Visita"] || "").trim().slice(0, 3),
          "Cód.Prd":  codProd,
          "Produto":  String(prod["Descricao"] || prod["Descrição"] || "").trim().slice(0, 38),
          "Gap SKU":  gap,
          "Est.":     prod["Disp."] || prod["Disponivel"] || "0",
        });
      }
    });
  });
  return rows;
}

const GapBadge = ({ gap }) => {
  const n = gapNum(gap);
  if (!gap || gap === "") return <span style={{color:"#94a3b8"}}>—</span>;
  if (String(gap).toUpperCase() === "OK") return <span style={{color:"#16a34a",fontWeight:700}}>OK</span>;
  if (n !== null && n < 0) return <span style={{color:"#dc2626",fontWeight:700}}>{n}</span>;
  return <span>{gap}</span>;
};

const ValBadge = ({ col, val }) => {
  const v = formatVal(col, val);
  if (!v) return <span style={{color:"#94a3b8"}}>—</span>;
  if (v === "OK") return <span style={{color:"#16a34a",fontWeight:700}}>OK</span>;
  if (v.endsWith("%")) return <span style={{color:"#b45309"}}>{v}</span>;
  return <span>{v}</span>;
};

const OkBadge = ({ val }) => {
  const v = String(val || "").trim();
  if (!v || v === "#N/A") return <span style={{color:"#94a3b8"}}>—</span>;
  if (v === "OK") return <span style={{background:"#16a34a",color:"white",borderRadius:4,padding:"1px 7px",fontWeight:700,fontSize:11}}>OK</span>;
  if (v === "0") return <span style={{background:"#dc2626",color:"white",borderRadius:4,padding:"1px 7px",fontWeight:700,fontSize:11}}>0</span>;
  const n = parseInt(v);
  if (!isNaN(n)) {
    const bg = n >= 60?"#16a34a":n >= 30?"#d97706":"#dc2626";
    return <span style={{background:bg,color:"white",borderRadius:4,padding:"1px 7px",fontWeight:700,fontSize:11}}>{n}</span>;
  }
  return <span>{v}</span>;
};

export default function App() {
  const [aba, setAba]         = useState("rota");
  const [setor, setSetor]     = useState(121);
  const [dia, setDia]         = useState(getDiaHoje());
  const [search, setSearch]   = useState("");
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLast] = useState(null);
  const [error, setError]     = useState("");

  const [rawLoja,    setRawLoja]    = useState([]);
  const [rawDesafio, setRawDesafio] = useState([]);
  const [rawCad,     setRawCad]     = useState([]);
  const [rawVnd,     setRawVnd]     = useState([]);
  const [rawEst,     setRawEst]     = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [loja, desafio, cad, vnd, est] = await Promise.all([
        fetchSheet("Loja Ideal"),
        fetchSheet("Desafio"),
        fetchSheet("01.20.11"),
        fetchSheet("03.05.09"),
        fetchSheet("Estoque"),
      ]);
      setRawLoja(loja); setRawDesafio(desafio);
      setRawCad(cad); setRawVnd(vnd); setRawEst(est);
      setLast(new Date().toLocaleString("pt-BR"));
    } catch(e) { setError("Erro ao carregar: " + e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const dadosRota = useMemo(() => {
    if (!rawLoja.length) return [];
    let data = parseLojaIdeal(rawLoja);
    data = data.filter(r => parseInt(r.Setor || "") === setor);
    if (dia !== "TODOS") data = data.filter(r => String(r.Visita||"").trim().toUpperCase().startsWith(dia));
    if (search.trim()) {
      const q = search.toLowerCase();
      data = data.filter(r => String(r.Fantasia||"").toLowerCase().includes(q) || String(r.Codigo||"").includes(q));
    }
    return [...data].sort((a,b) => {
      const ga = gapNum(a.Gap), gb = gapNum(b.Gap);
      if (ga!==null && gb!==null) return ga-gb;
      if (ga!==null) return -1;
      if (gb!==null) return 1;
      return 0;
    });
  }, [rawLoja, setor, dia, search]);

  const dadosDesafio = useMemo(() => {
    if (!rawDesafio.length) return [];
    let data = rowsToObjects(rawDesafio);
    data = data.filter(r => {
      const rn  = parseInt(r.RN || r.Setor || "");
      const pdm = String(r.PDM || "").toLowerCase().trim();
      return rn === setor && pdm === "loja ideal";
    });
    if (dia !== "TODOS") data = data.filter(r => String(r.Visita||"").trim().toUpperCase().startsWith(dia));
    if (search.trim()) {
      const q = search.toLowerCase();
      data = data.filter(r => String(r["Nome PDV"]||"").toLowerCase().includes(q) || String(r.PDV||"").includes(q));
    }
    return data.map(r => {
      const meta = parseInt(r["Meta Caixas"]||"0")||0;
      const real = parseInt(r["Real Desafio"]||"0")||0;
      const gap  = meta - real;
      return { ...r, _gap: gap <= 0 ? "OK" : String(gap) };
    });
  }, [rawDesafio, setor, dia, search]);

  const dadosSKU = useMemo(() => {
    if (!rawCad.length || !rawVnd.length || !rawEst.length) return [];
    const diaFiltro = dia !== "TODOS" ? dia : null;
    let rows = calcSKUVender(rawCad, rawVnd, rawEst, diaFiltro);
    rows = rows.filter(r => r.Setor === setor);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        String(r.Fantasia||"").toLowerCase().includes(q) ||
        String(r["Cód.Cli"]||"").includes(q) ||
        String(r.Produto||"").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [rawCad, rawVnd, rawEst, setor, dia, search]);

  const stats = useMemo(() => {
    if (aba==="rota") {
      const ok = dadosRota.filter(r => String(r["Lojas Ok"]||"").toUpperCase()==="OK").length;
      return { total: dadosRota.length, ok, label:"Loja Ideal OK" };
    }
    if (aba==="desafio") {
      const ok = dadosDesafio.filter(r => r._gap==="OK").length;
      return { total: dadosDesafio.length, ok, label:"Concluídos" };
    }
    const clientes = new Set(dadosSKU.map(r => r["Cód.Cli"])).size;
    return { total: dadosSKU.length, ok: clientes, label:"Clientes" };
  }, [aba, dadosRota, dadosDesafio, dadosSKU]);

  const COR_ABA = { rota:"#2563eb", desafio:"#c0392b", sku:"#7c3aed" };
  const cor = COR_ABA[aba];

  const thStyle = (extra={}) => ({
    padding:"9px 7px", textAlign:"center", fontWeight:700,
    whiteSpace:"nowrap", color:"white", ...extra
  });

  return (
    <div style={{minHeight:"100vh",background:"#f1f5f9",fontFamily:"'Segoe UI',Arial,sans-serif"}}>

      {/* HEADER */}
      <div style={{background:`linear-gradient(135deg,#1e3a5f 0%,${cor} 100%)`,color:"white",padding:"14px 20px 0"}}>
        <div style={{maxWidth:1400,margin:"0 auto"}}>

          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
            <div style={{background:"rgba(255,255,255,.15)",borderRadius:8,padding:"5px 12px",fontWeight:800,fontSize:18}}>🏪 Loja Ideal</div>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:16}}>Dashboard de Rota</div>
              {lastUpdate && <div style={{fontSize:11,opacity:.8}}>📡 Atualizado: {lastUpdate}</div>}
            </div>
            <button onClick={loadData} disabled={loading}
              style={{background:"rgba(255,255,255,.2)",border:"none",color:"white",padding:"7px 16px",
                      borderRadius:8,cursor:loading?"not-allowed":"pointer",fontWeight:700,fontSize:13}}>
              {loading?"⏳ Carregando...":"🔄 Atualizar Dados"}
            </button>
          </div>

          {/* Abas */}
          <div style={{display:"flex",gap:4,marginBottom:0}}>
            {[{key:"rota",icon:"📊",label:"Rota Completa"},{key:"desafio",icon:"🎯",label:"Desafio"},{key:"sku",icon:"📦",label:"SKU Vender"}].map(t=>(
              <button key={t.key} onClick={()=>{setAba(t.key);setSearch("");}}
                style={{padding:"8px 18px",borderRadius:"8px 8px 0 0",border:"none",cursor:"pointer",
                        fontWeight:700,fontSize:13,
                        background:aba===t.key?"white":"rgba(255,255,255,.15)",
                        color:aba===t.key?cor:"white"}}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* FILTROS */}
      <div style={{background:`linear-gradient(135deg,#1e3a5f 0%,${cor} 100%)`,padding:"10px 20px 14px"}}>
        <div style={{maxWidth:1400,margin:"0 auto",display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div>
            <label style={{fontSize:11,color:"rgba(255,255,255,.8)",display:"block",marginBottom:2}}>Setor</label>
            <select value={setor} onChange={e=>setSetor(Number(e.target.value))}
              style={{padding:"6px 12px",borderRadius:6,border:"none",fontWeight:700,fontSize:14,color:"#1e3a5f"}}>
              {SETORES_ALVO.map(s=><option key={s} value={s}>Setor {s}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:11,color:"rgba(255,255,255,.8)",display:"block",marginBottom:2}}>Dia de Visita</label>
            <div style={{display:"flex",gap:3}}>
              {DIAS.map(d=>(
                <button key={d} onClick={()=>setDia(d)}
                  style={{padding:"5px 9px",borderRadius:6,border:"none",cursor:"pointer",fontWeight:700,fontSize:11,
                          background:dia===d?"white":"rgba(255,255,255,.18)",
                          color:dia===d?cor:"white",
                          boxShadow:dia===d?"0 2px 6px rgba(0,0,0,.2)":"none"}}>
                  {d==="TODOS"?"Todos":d}
                </button>
              ))}
            </div>
          </div>
          <div style={{flex:1,maxWidth:260}}>
            <label style={{fontSize:11,color:"rgba(255,255,255,.8)",display:"block",marginBottom:2}}>Buscar PDV</label>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nome ou código..."
              style={{width:"100%",padding:"6px 10px",borderRadius:6,border:"none",fontSize:13,boxSizing:"border-box"}}/>
          </div>
          <div style={{display:"flex",gap:8,marginLeft:"auto"}}>
            <div style={{background:"rgba(255,255,255,.15)",borderRadius:8,padding:"6px 14px",textAlign:"center",minWidth:60}}>
              <div style={{fontWeight:800,fontSize:20}}>{stats.total}</div>
              <div style={{fontSize:10,opacity:.8}}>{aba==="sku"?"Oport.":"PDVs"}</div>
            </div>
            <div style={{background:"rgba(22,163,74,.35)",border:"1px solid rgba(22,163,74,.6)",borderRadius:8,padding:"6px 14px",textAlign:"center",minWidth:60}}>
              <div style={{fontWeight:800,fontSize:20}}>{stats.ok}</div>
              <div style={{fontSize:10,opacity:.8}}>{stats.label}</div>
            </div>
            {aba==="rota"&&(
              <div style={{background:"rgba(220,38,38,.3)",border:"1px solid rgba(220,38,38,.5)",borderRadius:8,padding:"6px 14px",textAlign:"center",minWidth:60}}>
                <div style={{fontWeight:800,fontSize:20}}>{stats.total-stats.ok}</div>
                <div style={{fontSize:10,opacity:.8}}>Com GAP</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* CONTEÚDO */}
      <div style={{maxWidth:1400,margin:"16px auto",padding:"0 12px"}}>
        {error&&<div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:8,padding:12,marginBottom:12,color:"#dc2626"}}>⚠️ {error}</div>}

        {loading&&(
          <div style={{background:"white",borderRadius:10,padding:48,textAlign:"center",boxShadow:"0 2px 12px rgba(0,0,0,.08)"}}>
            <div style={{fontSize:36,marginBottom:10}}>⏳</div>
            <div style={{fontWeight:700,fontSize:16,color:"#475569"}}>Carregando dados do Google Sheets...</div>
            <div style={{fontSize:12,color:"#94a3b8",marginTop:6}}>Buscando: Loja Ideal • Desafio • Cadastro • Vendas • Estoque</div>
          </div>
        )}

        {/* ROTA COMPLETA */}
        {!loading&&aba==="rota"&&(
          <div style={{background:"white",borderRadius:10,boxShadow:"0 2px 12px rgba(0,0,0,.08)",overflow:"hidden"}}>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr>
                    {[["Código","#1e3a5f"],["Fantasia","#1e3a5f"],["Visita","#1e3a5f"],["Sort Meta","#1e3a5f"],["Sort Real","#1e3a5f"],["Gap Sort","#dc2626"],["Exec Meta","#1e3a5f"],["Exec Real","#1e3a5f"],["Desaf Meta","#1e3a5f"],["Desaf Real","#1e3a5f"],["Desaf Gap","#1e3a5f"],["Loja OK","#16a34a"]].map(([h,bg])=>(
                      <th key={h} style={{...thStyle(),background:bg}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dadosRota.map((r,i)=>{
                    const isOk  = String(r["Lojas Ok"]||"").toUpperCase()==="OK";
                    const hasGap = gapNum(r.Gap)!==null && gapNum(r.Gap)<0;
                    const bg = isOk?"#f0fdf4":hasGap?"#fef2f2":i%2===0?"#fff":"#f8fafc";
                    return(
                      <tr key={i} style={{background:bg,borderBottom:"1px solid #e2e8f0"}}>
                        <td style={{padding:"6px 7px",color:"#64748b",fontSize:11}}>{r.Codigo}</td>
                        <td style={{padding:"6px 7px",fontWeight:isOk?700:500,color:isOk?"#15803d":"#1e293b",maxWidth:160,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.Fantasia}</td>
                        <td style={{padding:"6px 7px",textAlign:"center"}}><span style={{background:"#e0e7ff",color:"#3730a3",borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:600}}>{String(r.Visita||"").slice(0,3)}</span></td>
                        <td style={{padding:"6px 7px",textAlign:"center",color:"#475569"}}>{r["Sort Meta"]||"—"}</td>
                        <td style={{padding:"6px 7px",textAlign:"center",fontWeight:600}}>{r["Sort Real"]||"—"}</td>
                        <td style={{padding:"6px 7px",textAlign:"center"}}><GapBadge gap={r.Gap}/></td>
                        <td style={{padding:"6px 7px",textAlign:"center",fontSize:11,color:"#475569"}}>{r["Exec Meta"]||"—"}</td>
                        <td style={{padding:"6px 7px",textAlign:"center"}}><ValBadge col="Exec Real" val={r["Exec Real"]}/></td>
                        <td style={{padding:"6px 7px",textAlign:"center",fontSize:11,color:"#475569"}}>{r["Desaf Meta"]||"—"}</td>
                        <td style={{padding:"6px 7px",textAlign:"center"}}>{r["Real"]||"—"}</td>
                        <td style={{padding:"6px 7px",textAlign:"center"}}><ValBadge col="Desaf Gap" val={r["Desaf Gap"]}/></td>
                        <td style={{padding:"6px 7px",textAlign:"center"}}><OkBadge val={r["Lojas Ok"]}/></td>
                      </tr>
                    );
                  })}
                  {dadosRota.length===0&&<tr><td colSpan={12} style={{textAlign:"center",padding:32,color:"#94a3b8"}}>Nenhum PDV encontrado.</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{padding:"8px 14px",background:"#f8fafc",borderTop:"1px solid #e2e8f0",fontSize:11,color:"#64748b",display:"flex",gap:20}}>
              <span>Setor <b>{setor}</b> | <b>{stats.total}</b> PDVs | <b style={{color:"#16a34a"}}>{stats.ok} OK</b> | <b style={{color:"#dc2626"}}>{stats.total-stats.ok} GAP</b></span>
              <span style={{marginLeft:"auto"}}>🟢 Verde = OK &nbsp;🔴 Vermelho = GAP negativo</span>
            </div>
          </div>
        )}

        {/* DESAFIO */}
        {!loading&&aba==="desafio"&&(
          <div style={{background:"white",borderRadius:10,boxShadow:"0 2px 12px rgba(0,0,0,.08)",overflow:"hidden"}}>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr>
                    {[["PDV","#c0392b"],["Nome PDV","#c0392b"],["Visita","#c0392b"],["SKU Oferta","#c0392b"],["Nome Oferta","#c0392b"],["Status","#c0392b"],["Meta Cx","#c0392b"],["Real","#c0392b"],["GAP","#922b21"]].map(([h,bg])=>(
                      <th key={h} style={{...thStyle(),background:bg}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dadosDesafio.map((r,i)=>{
                    const gapOk = r._gap==="OK";
                    const status = String(r["Status Oferta"]||"").toLowerCase();
                    const concluido = status.includes("nclu");
                    return(
                      <tr key={i} style={{background:gapOk?"#f0fdf4":i%2===0?"#fff":"#fef9f9",borderBottom:"1px solid #e2e8f0"}}>
                        <td style={{padding:"6px 7px",color:"#64748b",fontSize:11}}>{r.PDV}</td>
                        <td style={{padding:"6px 7px",fontWeight:500,maxWidth:160,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r["Nome PDV"]}</td>
                        <td style={{padding:"6px 7px",textAlign:"center"}}><span style={{background:"#fde8e8",color:"#c0392b",borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:600}}>{String(r.Visita||"").slice(0,3)}</span></td>
                        <td style={{padding:"6px 7px",textAlign:"center",fontSize:11}}>{r["SKU Oferta"]||"—"}</td>
                        <td style={{padding:"6px 7px",fontSize:11,maxWidth:220,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{String(r["Nome Oferta"]||"").slice(0,65)}</td>
                        <td style={{padding:"6px 7px",textAlign:"center"}}><span style={{color:concluido?"#16a34a":"#d97706",fontWeight:600,fontSize:11}}>{r["Status Oferta"]||"—"}</span></td>
                        <td style={{padding:"6px 7px",textAlign:"center",fontWeight:600}}>{r["Meta Caixas"]||"0"}</td>
                        <td style={{padding:"6px 7px",textAlign:"center"}}>{r["Real Desafio"]||"0"}</td>
                        <td style={{padding:"6px 7px",textAlign:"center",fontWeight:700}}>{gapOk?<span style={{color:"#16a34a"}}>OK</span>:<span style={{color:"#dc2626"}}>{r._gap}</span>}</td>
                      </tr>
                    );
                  })}
                  {dadosDesafio.length===0&&<tr><td colSpan={9} style={{textAlign:"center",padding:32,color:"#94a3b8"}}>Nenhum desafio encontrado para este setor/dia.</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{padding:"8px 14px",background:"#f8fafc",borderTop:"1px solid #e2e8f0",fontSize:11,color:"#64748b"}}>
              Setor <b>{setor}</b> | <b>{stats.total}</b> ofertas | <b style={{color:"#16a34a"}}>{stats.ok} concluídas</b>
            </div>
          </div>
        )}

        {/* SKU VENDER */}
        {!loading&&aba==="sku"&&(
          <div style={{background:"white",borderRadius:10,boxShadow:"0 2px 12px rgba(0,0,0,.08)",overflow:"hidden"}}>
            <div style={{padding:"10px 14px",background:"#f5f3ff",borderBottom:"1px solid #e2e8f0",fontSize:12,color:"#5b21b6"}}>
              📦 <b>SKU Vender</b> — Clientes com Gap SKU negativo × produtos disponíveis no estoque que ainda não compraram (Cerveja)
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr>
                    {["Cód.Cli","Fantasia","Visita","Cód.Prd","Produto","Gap SKU","Estoque","Ação"].map(h=>(
                      <th key={h} style={{...thStyle(),background:"#7c3aed"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dadosSKU.map((r,i)=>(
                    <tr key={i} style={{background:i%2===0?"#fff":"#faf5ff",borderBottom:"1px solid #e2e8f0"}}>
                      <td style={{padding:"6px 7px",color:"#64748b",fontSize:11}}>{r["Cód.Cli"]}</td>
                      <td style={{padding:"6px 7px",fontWeight:500,maxWidth:160,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.Fantasia}</td>
                      <td style={{padding:"6px 7px",textAlign:"center"}}><span style={{background:"#ede9fe",color:"#7c3aed",borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:600}}>{r.Visita}</span></td>
                      <td style={{padding:"6px 7px",textAlign:"center",color:"#64748b",fontSize:11}}>{r["Cód.Prd"]}</td>
                      <td style={{padding:"6px 7px",fontSize:11,maxWidth:220}}>{r.Produto}</td>
                      <td style={{padding:"6px 7px",textAlign:"center",fontWeight:700,color:"#dc2626"}}>{r["Gap SKU"]}</td>
                      <td style={{padding:"6px 7px",textAlign:"center",color:"#475569"}}>{r["Est."]}</td>
                      <td style={{padding:"6px 7px",textAlign:"center"}}><span style={{background:"#dc2626",color:"white",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700}}>Vender!</span></td>
                    </tr>
                  ))}
                  {dadosSKU.length===0&&(
                    <tr><td colSpan={8} style={{textAlign:"center",padding:32,color:"#94a3b8"}}>
                      {rawCad.length===0?"Carregando dados...":"Nenhuma oportunidade encontrada para este setor/dia."}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{padding:"8px 14px",background:"#f8fafc",borderTop:"1px solid #e2e8f0",fontSize:11,color:"#64748b"}}>
              Setor <b>{setor}</b> | <b>{stats.total}</b> oportunidades | <b style={{color:"#7c3aed"}}>{stats.ok} clientes</b>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
