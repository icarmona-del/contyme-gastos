import { useState, useRef, useEffect } from "react";

const GOOGLE_CLIENT_ID = "447335181295-dnpmatjslushr51c1lcp8l84btkog9ih.apps.googleusercontent.com";

const CONTYME_EMAIL = "Icarmona@contyme.cl";

const SCOPES = ["https://www.googleapis.com/auth/drive.file","https://www.googleapis.com/auth/spreadsheets","profile","email"].join(" ");

function formatMonto(val) { const n = val.replace(/\D/g, ""); return n ? "$" + parseInt(n).toLocaleString("es-CL") : ""; }

function parseMontoNum(val) { return parseInt(val.replace(/\D/g, "") || "0"); }

function fechaHoy() { const d = new Date(); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; }

async function crearCarpetaEnDrive(token, nombre, padreId = null) {
  const meta = { name: nombre, mimeType: "application/vnd.google-apps.folder", ...(padreId ? { parents: [padreId] } : {}) };
  const res = await fetch("https://www.googleapis.com/drive/v3/files", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(meta) });
  return res.json();
}

async function buscarEnDrive(token, nombre, mimeType, padreId = null) {
  let q = `name='${nombre}' and mimeType='${mimeType}' and trashed=false`;
  if (padreId) q += ` and '${padreId}' in parents`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return data.files?.[0] || null;
}

async function compartirConContyme(token, fileId) {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ role: "reader", type: "user", emailAddress: CONTYME_EMAIL }) });
}

async function subirFoto(token, file, carpetaId, nombreArchivo) {
  const meta = { name: nombreArchivo, parents: [carpetaId] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
  form.append("file", file);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  return res.json();
}

async function hacerPublico(token, fileId) {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ role: "reader", type: "anyone" }) });
}

async function crearSheet(token, nombre, carpetaId) {
  const res = await fetch("https://www.googleapis.com/drive/v3/files", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: nombre, mimeType: "application/vnd.google-apps.spreadsheet", parents: [carpetaId] }) });
  const sheet = await res.json();
  await fetch(`https://www.googleapis.com/v4/spreadsheets/${sheet.id}/values/A1:D1?valueInputOption=RAW`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ values: [["Fecha", "Concepto", "Monto", "Ver Boleta"]] }) });
  return sheet;
}

async function agregarFilaSheet(token, sheetId, fila) {
  await fetch(`https://www.googleapis.com/v4/spreadsheets/${sheetId}/values/A:D:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ values: [fila] }) });
}

async function obtenerOCrearEstructura(token, rut) {
  const nombreCarpeta = `Gastos Menores - Contyme (${rut})`;
  let carpeta = await buscarEnDrive(token, nombreCarpeta, "application/vnd.google-apps.folder");
  if (!carpeta) { carpeta = await crearCarpetaEnDrive(token, nombreCarpeta); await compartirConContyme(token, carpeta.id); }
  let carpetaBoletas = await buscarEnDrive(token, "Boletas", "application/vnd.google-apps.folder", carpeta.id);
  if (!carpetaBoletas) { carpetaBoletas = await crearCarpetaEnDrive(token, "Boletas", carpeta.id); }
  let sheet = await buscarEnDrive(token, "Registro de Gastos", "application/vnd.google-apps.spreadsheet", carpeta.id);
  if (!sheet) { sheet = await crearSheet(token, "Registro de Gastos", carpeta.id); await compartirConContyme(token, sheet.id); }
  return { carpetaId: carpeta.id, boletasId: carpetaBoletas.id, sheetId: sheet.id };
}

export default function ContymeGastos() {
  const [token, setToken] = useState(null);
  const [usuario, setUsuario] = useState(null);
  const [rut, setRut] = useState("");
  const [rutConfirmado, setRutConfirmado] = useState(false);
  const [form, setForm] = useState({ fecha: fechaHoy(), concepto: "", monto: "" });
  const [imgFile, setImgFile] = useState(null);
  const [imgPreview, setImgPreview] = useState(null);
  const [gastos, setGastos] = useState([]);
  const [estado, setEstado] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();
  const tokenClientRef = useRef(null);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID, scope: SCOPES,
        callback: async (resp) => {
          if (resp.access_token) {
            setToken(resp.access_token);
            const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${resp.access_token}` } }).then((r) => r.json());
            setUsuario(me);
          }
        },
      });
    };
    document.head.appendChild(script);
  }, []);

  const login = () => tokenClientRef.current?.requestAccessToken();

  const procesarArchivo = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setImgFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setImgPreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const guardarGasto = async () => {
    if (!form.fecha || !form.concepto || !form.monto || !imgFile) return;
    setEstado("subiendo");
    try {
      const { boletasId, sheetId } = await obtenerOCrearEstructura(token, rut);
      const fechaArchivo = form.fecha.replace(/\//g, "-");
      const nombreArchivo = `boleta_${fechaArchivo}_${form.concepto.slice(0, 20).replace(/\s/g, "_")}.jpg`;
      const foto = await subirFoto(token, imgFile, boletasId, nombreArchivo);
      await hacerPublico(token, foto.id);
      const linkFoto = `https://drive.google.com/file/d/${foto.id}/view`;
      const montoNum = parseMontoNum(form.monto);
      await agregarFilaSheet(token, sheetId, [form.fecha, form.concepto, montoNum, linkFoto]);
      setGastos((prev) => [{ id: Date.now(), fecha: form.fecha, concepto: form.concepto, monto: montoNum, link: linkFoto, img: imgPreview }, ...prev]);
      setForm({ fecha: fechaHoy(), concepto: "", monto: "" });
      setImgFile(null); setImgPreview(null);
      setEstado("ok"); setTimeout(() => setEstado(null), 3000);
    } catch (e) { console.error(e); setEstado("error"); setTimeout(() => setEstado(null), 4000); }
  };

  const total = gastos.reduce((s, g) => s + g.monto, 0);

  if (!token) return (
    <div style={{ minHeight:"100vh", background:"#1a2332", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:"'Georgia',serif", padding:32 }}>
      <div style={{ fontSize:36, fontWeight:700, color:"#e8c96d", letterSpacing:3, marginBottom:8 }}>CONTYME</div>
      <div style={{ color:"#8fa3b8", fontSize:12, letterSpacing:3, marginBottom:60, textTransform:"uppercase" }}>Registro de Gastos</div>
      <div style={{ background:"#ffffff10", border:"1px solid #ffffff20", borderRadius:16, padding:"36px 28px", textAlign:"center", maxWidth:320, width:"100%" }}>
        <div style={{ fontSize:40, marginBottom:16 }}>📂</div>
        <div style={{ color:"#fff", fontSize:16, fontWeight:600, marginBottom:8 }}>Bienvenido</div>
        <div style={{ color:"#8fa3b8", fontSize:13, marginBottom:32, lineHeight:1.6 }}>Conecta tu cuenta Google para guardar tus gastos y boletas en tu Drive personal</div>
        <button onClick={login} style={{ width:"100%", padding:"14px", background:"#e8c96d", color:"#1a2332", border:"none", borderRadius:10, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"'Georgia',serif" }}>Conectar con Google</button>
      </div>
      <div style={{ color:"#3a5a7a", fontSize:10, marginTop:40, letterSpacing:2 }}>CONTYME · ASESORÍA CONTABLE Y TRIBUTARIA</div>
    </div>
  );

  if (!rutConfirmado) return (
    <div style={{ minHeight:"100vh", background:"#1a2332", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:"'Georgia',serif", padding:32 }}>
      <div style={{ fontSize:28, fontWeight:700, color:"#e8c96d", letterSpacing:3, marginBottom:48 }}>CONTYME</div>
      <div style={{ background:"#ffffff10", border:"1px solid #ffffff20", borderRadius:16, padding:"36px 28px", textAlign:"center", maxWidth:320, width:"100%" }}>
        <div style={{ color:"#8fa3b8", fontSize:12, marginBottom:6 }}>Conectado como</div>
        <div style={{ color:"#fff", fontSize:14, fontWeight:600, marginBottom:28 }}>{usuario?.email}</div>
        <div style={{ color:"#e8c96d", fontSize:14, fontWeight:600, marginBottom:16 }}>Ingresa tu RUT</div>
        <input type="text" value={rut} onChange={(e) => setRut(e.target.value)} placeholder="12.345.678-9"
          style={{ width:"100%", padding:"12px", border:"1px solid #ffffff30", borderRadius:8, fontSize:16, color:"#fff", background:"#ffffff15", outline:"none", boxSizing:"border-box", textAlign:"center", fontFamily:"'Georgia',serif", marginBottom:20 }} />
        <button onClick={() => rut.length > 5 && setRutConfirmado(true)} disabled={rut.length < 5}
          style={{ width:"100%", padding:"13px", background:rut.length < 5 ? "#ffffff20":"#e8c96d", color:rut.length < 5 ? "#ffffff40":"#1a2332", border:"none", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"'Georgia',serif" }}>
          Continuar
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#f5f2ee", fontFamily:"'Georgia','Times New Roman',serif", padding:"0 0 60px" }}>
      <div style={{ background:"#1a2332", padding:"24px 28px 20px", display:"flex", alignItems:"flex-end", gap:16, boxShadow:"0 2px 12px rgba(0,0,0,0.18)" }}>
        <div>
          <div style={{ fontWeight:700, fontSize:24, color:"#e8c96d", letterSpacing:2 }}>CONTYME</div>
          <div style={{ color:"#8fa3b8", fontSize:10, letterSpacing:3, marginTop:3, textTransform:"uppercase" }}>Registro de Gastos</div>
        </div>
        <div style={{ flex:1 }} />
        <div style={{ textAlign:"right" }}>
          <div style={{ color:"#e8c96d", fontSize:12, fontWeight:600 }}>{usuario?.name}</div>
          <div style={{ color:"#5a7a99", fontSize:10, letterSpacing:1 }}>{rut}</div>
        </div>
      </div>

      <div style={{ maxWidth:520, margin:"0 auto", padding:"28px 20px 0" }}>
        <div onClick={() => fileRef.current.click()} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); procesarArchivo(e.dataTransfer.files[0]); }}
          style={{ border:dragOver?"2px solid #e8c96d":"2px dashed #b8a87a", borderRadius:12, background:dragOver?"#fdf8ec":"#faf8f4", padding:imgPreview?12:"32px 20px", textAlign:"center", cursor:"pointer", transition:"all 0.2s" }}>
          <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={(e) => procesarArchivo(e.target.files[0])} />
          {imgPreview ? (
            <div style={{ display:"flex", gap:14, alignItems:"center" }}>
              <img src={imgPreview} alt="boleta" style={{ width:80, height:80, objectFit:"cover", borderRadius:8, border:"1px solid #d4c49a", flexShrink:0 }} />
              <div style={{ textAlign:"left" }}>
                <div style={{ color:"#3a6b3a", fontSize:13, fontWeight:600 }}>✓ Boleta adjunta</div>
                <button onClick={(e) => { e.stopPropagation(); fileRef.current.click(); }} style={{ marginTop:8, background:"none", border:"1px solid #b8a87a", color:"#7a6a3a", fontSize:11, padding:"4px 10px", borderRadius:6, cursor:"pointer" }}>Cambiar foto</button>
              </div>
            </div>
          ) : (<><div style={{ fontSize:32, marginBottom:8 }}>📄</div><div style={{ color:"#6a5a3a", fontSize:14, fontWeight:600, marginBottom:4 }}>Foto de la boleta</div><div style={{ color:"#a09070", fontSize:12 }}>Toca para seleccionar o fotografiar</div></>)}
        </div>

        <div style={{ background:"#fff", borderRadius:12, border:"1px solid #e0d8c8", padding:"22px 20px", marginTop:16, boxShadow:"0 2px 8px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize:11, letterSpacing:2, color:"#a09070", marginBottom:16, textTransform:"uppercase" }}>Detalle del Gasto</div>
          {[{label:"Fecha",key:"fecha",placeholder:"DD/MM/YYYY"},{label:"Concepto / Comercio",key:"concepto",placeholder:"Ej: Ferretería El Clavo"}].map(({label,key,placeholder}) => (
            <div key={key} style={{ marginBottom:14 }}>
              <label style={{ display:"block", fontSize:11, color:"#8a7a5a", letterSpacing:1, marginBottom:5, textTransform:"uppercase" }}>{label}</label>
              <input type="text" value={form[key]} onChange={(e) => setForm((f) => ({...f,[key]:e.target.value}))} placeholder={placeholder}
                style={{ width:"100%", padding:"10px 12px", border:"1px solid #ddd8cc", borderRadius:8, fontSize:14, color:"#2a2218", background:"#faf9f6", outline:"none", boxSizing:"border-box", fontFamily:"'Georgia',serif" }} />
            </div>
          ))}
          <div style={{ marginBottom:20 }}>
            <label style={{ display:"block", fontSize:11, color:"#8a7a5a", letterSpacing:1, marginBottom:5, textTransform:"uppercase" }}>Monto</label>
            <input type="text" value={form.monto} onChange={(e) => setForm((f) => ({...f,monto:formatMonto(e.target.value)}))} placeholder="$0"
              style={{ width:"100%", padding:"10px 12px", border:"1px solid #ddd8cc", borderRadius:8, fontSize:20, color:"#1a2332", background:"#faf9f6", outline:"none", boxSizing:"border-box", fontWeight:700, fontFamily:"'Georgia',serif" }} />
          </div>
          <button onClick={guardarGasto} disabled={!form.fecha||!form.concepto||!form.monto||!imgFile||estado==="subiendo"}
            style={{ width:"100%", padding:"13px", background:estado==="ok"?"#3a7a3a":estado==="error"?"#aa3020":(!form.fecha||!form.concepto||!form.monto||!imgFile||estado==="subiendo")?"#c8c0a8":"#1a2332", color:(!form.fecha||!form.concepto||!form.monto||!imgFile||estado==="subiendo")?"#9a9080":"#e8c96d", border:"none", borderRadius:8, fontSize:13, fontWeight:700, letterSpacing:2, textTransform:"uppercase", cursor:"pointer", transition:"all 0.3s", fontFamily:"'Georgia',serif" }}>
            {estado==="subiendo"?"⏳ Guardando en Drive...":estado==="ok"?"✓ Guardado en Drive":estado==="error"?"✗ Error — intenta de nuevo":"Registrar Gasto"}
          </button>
          {!imgFile&&form.fecha&&form.concepto&&form.monto&&<div style={{ textAlign:"center", color:"#a09070", fontSize:11, marginTop:10 }}>Adjunta la foto de la boleta para continuar</div>}
        </div>

        {gastos.length>0&&(
          <div style={{ marginTop:28 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:14 }}>
              <div style={{ fontSize:11, letterSpacing:2, color:"#a09070", textTransform:"uppercase" }}>Esta sesión</div>
              <div style={{ fontSize:13, color:"#1a2332", fontWeight:700 }}>Total: ${total.toLocaleString("es-CL")}</div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {gastos.map((g) => (
                <div key={g.id} style={{ background:"#fff", border:"1px solid #e0d8c8", borderRadius:10, padding:"12px 16px", display:"flex", alignItems:"center", gap:12, boxShadow:"0 1px 4px rgba(0,0,0,0.04)" }}>
                  {g.img&&<img src={g.img} alt="" style={{ width:42, height:42, objectFit:"cover", borderRadius:6, border:"1px solid #e0d0a8", flexShrink:0 }} />}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, color:"#1a2332", fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{g.concepto}</div>
                    <div style={{ fontSize:11, color:"#a09070", marginTop:2 }}>{g.fecha}</div>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
                    <div style={{ fontSize:14, color:"#1a2332", fontWeight:700 }}>${g.monto.toLocaleString("es-CL")}</div>
                    <a href={g.link} target="_blank" rel="noreferrer" style={{ fontSize:10, color:"#5a7a99", textDecoration:"none", border:"1px solid #c0d0e0", borderRadius:4, padding:"2px 6px" }}>Ver boleta</a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop:40, textAlign:"center", color:"#c0b89a", fontSize:10, letterSpacing:2 }}>CONTYME · ASESORÍA CONTABLE Y TRIBUTARIA</div>
      </div>

      <style>{`input:focus { border-color: #e8c96d !important; }`}</style>
    </div>
  );
}
