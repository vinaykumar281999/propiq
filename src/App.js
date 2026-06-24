import { useState, useEffect } from "react";

const API = "http://localhost:8000";

export default function App() {
  const [query, setQuery] = useState("");
  const [neighborhoods, setNeighborhoods] = useState([]);
  const [selected, setSelected] = useState(null);
  const [analysis, setAnalysis] = useState(null);

  useEffect(() => {
    fetch(`${API}/api/v1/properties?limit=100`)
      .then(r => r.json())
      .then(data => setNeighborhoods(data.properties || []))
      .catch(() => {});
  }, []);

  const search = (q) => {
    setQuery(q);
    fetch(`${API}/api/v1/properties?search=${q}&limit=100`)
      .then(r => r.json())
      .then(data => setNeighborhoods(data.properties || []));
  };

  const select = (n) => {
    setSelected(n);
    setAnalysis(null);
    fetch(`${API}/api/v1/properties/${n.id}`)
      .then(r => r.json())
      .then(setAnalysis);
  };

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:"#080c0a",color:"#e8f0eb",fontFamily:"system-ui"}}>
      <div style={{padding:"14px 20px",borderBottom:"1px solid #1c2e20",background:"#0d1410",display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontWeight:800,fontSize:18,color:"#3ddc77"}}>🏠 PropIQ</span>
        <span style={{fontSize:12,color:"#4d6657",marginLeft:8}}>{neighborhoods.length} neighborhoods loaded</span>
        <input value={query} onChange={e=>search(e.target.value)} placeholder="Search neighborhoods..." style={{flex:1,maxWidth:400,marginLeft:"auto",background:"#080c0a",border:"1px solid #1c2e20",borderRadius:8,padding:"7px 12px",color:"#e8f0eb",fontSize:13,outline:"none"}} />
      </div>
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        <div style={{width:320,borderRight:"1px solid #1c2e20",overflowY:"auto",background:"#0d1410"}}>
          {neighborhoods.length === 0 && <div style={{padding:20,color:"#4d6657",fontSize:13}}>Loading...</div>}
          {neighborhoods.map(n => (
            <div key={n.id} onClick={()=>select(n)} style={{padding:"12px 16px",borderBottom:"1px solid #1c2e20",cursor:"pointer",background:selected?.id===n.id?"#0f2b20":"transparent"}}>
              <div style={{fontWeight:600,fontSize:13,color:selected?.id===n.id?"#3ddc77":"#e8f0eb"}}>{n.name}</div>
              <div style={{display:"flex",gap:10,fontSize:11,marginTop:4}}>
                <span style={{color:"#8fa898"}}>${(n.price/1000).toFixed(0)}k</span>
                <span style={{color:"#3ddc77"}}>ROI {n.roi_pct?.toFixed(1)}%</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{flex:1,overflowY:"auto",padding:28}}>
          {!selected && <div style={{color:"#4d6657",textAlign:"center",marginTop:80,fontSize:15}}>← Select a neighborhood to see investment analysis</div>}
          {analysis && (
            <div style={{maxWidth:700}}>
              <h2 style={{fontSize:24,fontWeight:700,marginBottom:4}}>{analysis.name}</h2>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:24,marginTop:16}}>
                {[["Price","$"+(analysis.price/1000).toFixed(0)+"k"],["Expected Return","$"+analysis.expected_return?.toFixed(0)],["ROI",analysis.roi_pct?.toFixed(1)+"%"]].map(([l,v])=>(
                  <div key={l} style={{background:"#0d1410",border:"1px solid #1c2e20",borderRadius:10,padding:14}}>
                    <div style={{fontSize:10,color:"#4d6657",textTransform:"uppercase",marginBottom:4}}>{l}</div>
                    <div style={{fontSize:22,fontWeight:700,color:"#3ddc77"}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{background:analysis.roi_pct>=10?"#052e16":analysis.roi_pct>=5?"#1a1800":"#1a0505",border:`1px solid ${analysis.roi_pct>=10?"#1a4d2e":analysis.roi_pct>=5?"#3d3300":"#3d1010"}`,borderRadius:10,padding:20,marginBottom:16}}>
                <div style={{fontSize:22,fontWeight:800,color:analysis.roi_pct>=10?"#3ddc77":analysis.roi_pct>=5?"#f5c842":"#ff5f5f"}}>
                  {analysis.roi_pct>=10?"✅ BUY":analysis.roi_pct>=5?"⚠️ HOLD OFF":"❌ AVOID"}
                </div>
                <div style={{fontSize:13,color:"#8fa898",marginTop:8}}>
                  ROI: {analysis.roi_pct?.toFixed(1)}% · Expected 6-month return: ${analysis.expected_return?.toFixed(0)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
