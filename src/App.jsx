import { useState, useEffect } from "react";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut 
} from "firebase/auth";
import { 
  doc, 
  collection, 
  writeBatch, 
  increment,
  onSnapshot,
  query,
  orderBy,
  limit,
  getDocs,
  startAfter
} from "firebase/firestore";
import { db, auth } from "./firebase"; 

function App() {
  // Control de usuario y estado del negocio
  const [usuario, setUsuario] = useState(null);
  const [negocioActivo, setNegocioActivo] = useState(true);
  const [cargandoAuth, setCargandoAuth] = useState(true);
  const [procesandoAccion, setProcesandoAccion] = useState(false);
  const [modoRegistro, setModoRegistro] = useState(false);
  
  // Estado del menú: 'dashboard', 'registrar', 'historial'
  const [seccionActiva, setSeccionActiva] = useState("dashboard");
  
  // Métricas
  const [metricasMes, setMetricasMes] = useState({ total_ventas: 0, cantidad_transacciones: 0 });
  
  // Historial y Paginación
  const [facturas, setFacturas] = useState([]);
  const [ultimoDoc, setUltimoDoc] = useState(null);
  const [hayMasFacturas, setHayMasFacturas] = useState(true);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  // Formularios
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [nombreNegocio, setNombreNegocio] = useState("");

  const [tipoDoc, setTipoDoc] = useState("Recibo Interno");
  const [identificacion, setIdentificacion] = useState("");
  const [nombreCliente, setNombreCliente] = useState("");
  const [correoCliente, setCorreoCliente] = useState("");
  const [celularCliente, setCelularCliente] = useState("");
  
  // NUEVO: Estado para el celular
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [metodoPago, setMetodoPago] = useState("Efectivo");
  const [tarifaIva, setTarifaIva] = useState("0");
  
  const obtenerPeriodoActual = () => {
    const fecha = new Date();
    return `${fecha.getFullYear()}_${String(fecha.getMonth() + 1).padStart(2, "0")}`;
  };
  
  useEffect(() => {
    const desuscribirAuth = onAuthStateChanged(auth, async (user) => {
      setUsuario(user);

      if (user) {
        // 1. Escuchar el estado de activación del negocio en tiempo real (CON CAPTURA DE ERROR)
        const negocioRef = doc(db, "negocios", user.uid);
        const desuscribirNegocio = onSnapshot(negocioRef, (docSnap) => {
          if (docSnap.exists()) {
            const datos = docSnap.data();
            setNegocioActivo(datos.activo !== false); 
          } else {
            setNegocioActivo(true);
          }
          setCargandoAuth(false);
        }, (error) => {
          console.error("Error crítico en regla o lectura de negocio:", error);
          setNegocioActivo(true); 
          setCargandoAuth(false);
        });

        // 2. Escuchar las métricas financieras del mes
        const periodo = obtenerPeriodoActual();
        const metricasRef = doc(db, `negocios/${user.uid}/metricas`, periodo);
        const desuscribirMetricas = onSnapshot(metricasRef, (docSnap) => {
          if (docSnap.exists()) {
            setMetricasMes(docSnap.data());
          } else {
            setMetricasMes({ total_ventas: 0, cantidad_transacciones: 0 });
          }
        }, (error) => {
          console.error("Error escuchando métricas:", error);
        });

        cargarPrimerasFacturas(user.uid);

        return () => {
          desuscribirNegocio();
          desuscribirMetricas();
        };
      } else {
        setCargandoAuth(false);
      }
    });

    return () => desuscribirAuth();
  }, [usuario]);

  const cargarPrimerasFacturas = async (uid) => {
    setCargandoHistorial(true);
    try {
      const q = query(
        collection(db, `negocios/${uid}/facturas`),
        orderBy("fecha_creacion", "desc"),
        limit(10)
      );
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        const listaDocs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setFacturas(listaDocs);
        setUltimoDoc(snapshot.docs[snapshot.docs.length - 1]);
        setHayMasFacturas(snapshot.docs.length === 10);
      } else {
        setFacturas([]);
        setHayMasFacturas(false);
      }
    } catch (error) {
      console.error("Error cargando historial de facturas:", error);
    } finally {
      setCargandoHistorial(false);
    }
  };
  
  const cargarMasFacturas = async () => {
    if (!usuario || !ultimoDoc || cargandoHistorial) return;
    setCargandoHistorial(true);
    try {
      const q = query(
        collection(db, `negocios/${usuario.uid}/facturas`),
        orderBy("fecha_creacion", "desc"),
        startAfter(ultimoDoc),
        limit(10)
      );
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const nuevosDocs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setFacturas(prev => [...prev, ...nuevosDocs]);
        setUltimoDoc(snapshot.docs[snapshot.docs.length - 1]);
        setHayMasFacturas(snapshot.docs.length === 10);
      } else {
        setHayMasFacturas(false);
      }
    } catch (error) {
      console.error("Error cargando más facturas:", error);
    } finally {
      setCargandoHistorial(false);
    }
  };
  
  const ejecutarAuth = async (e) => {
    e.preventDefault();
    setProcesandoAccion(true);
    try {
      if (modoRegistro) {
        const credenciales = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        const batch = writeBatch(db);
        const negocioRef = doc(db, "negocios", credenciales.user.uid);
        batch.set(negocioRef, { 
          nombre_comercial: nombreNegocio, 
          fecha_registro: new Date(), 
          plan: "Gratuito",
          activo: true 
        });
        await batch.commit();
        alert("Establecimiento registrado exitosamente.");
      } else {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      }
      setAuthEmail(""); setAuthPassword(""); setNombreNegocio("");
    } catch (error) {
      alert("Error de autenticación. Verifique sus credenciales de acceso.");
    } finally {
      setProcesandoAccion(false);
    }
  };
  
  const cerrarSesion = () => {
    signOut(auth);
    setMetricasMes({ total_ventas: 0, cantidad_transacciones: 0 });
    setFacturas([]);
    setUltimoDoc(null);
    setSeccionActiva("dashboard");
    setNegocioActivo(true);
  };

  const registrarVenta = async (e) => {
    e.preventDefault();
    if (!usuario || !negocioActivo) return;
    setProcesandoAccion(true);
    try {
      const fechaActual = new Date();
      const periodoMetricas = obtenerPeriodoActual();
      const batch = writeBatch(db);
      const totalPagar = Number(monto);
      const factorDivisor = 1 + (Number(tarifaIva) / 100);
      const baseGravable = totalPagar / factorDivisor;
      const valorIva = totalPagar - baseGravable;

      const nuevaFacturaData = {
        tipo_documento: tipoDoc,
        cliente: {
          identificacion: identificacion || "Consumidor Final",
          nombre: nombreCliente || "Cuantías Menores",
          correo: correoCliente || "N/A",
          celular: celularCliente || "N/A"
        },
        venta: { 
          concepto, 
          monto_total: totalPagar, 
          base_gravable: Number(baseGravable.toFixed(2)),
          valor_iva: Number(valorIva.toFixed(2)),
          porcentaje_iva: Number(tarifaIva),
          metodo_pago: metodoPago 
        },
        estado_dian: tipoDoc === "Factura Electrónica" ? "Pendiente" : "No aplica",
        fecha_creacion: fechaActual
      };
      
      const facturaRef = doc(collection(db, `negocios/${usuario.uid}/facturas`));
      batch.set(facturaRef, nuevaFacturaData);

      const metricasRef = doc(db, `negocios/${usuario.uid}/metricas`, periodoMetricas);
      batch.set(metricasRef, {
        total_ventas: increment(totalPagar),
        cantidad_transacciones: increment(1),
        ultima_actualizacion: fechaActual
      }, { merge: true });
      
      await batch.commit();
      
      setFacturas(prev => [{ id: facturaRef.id, ...nuevaFacturaData }, ...prev]);
      alert("Registro guardado con éxito en el sistema contable.");
      
      // Limpiar todos los campos del formulario tras procesar la venta
      setIdentificacion(""); 
      setNombreCliente(""); 
      setCorreoCliente(""); 
      setCelularCliente("");
      setConcepto(""); 
      setMonto(""); 
      setTarifaIva("0");
    } catch (error) {
      alert("Error al procesar la transacción.");
    } finally {
      setProcesandoAccion(false);
    }
  };
  
  const descargarPDF = (factura) => {
    const elemento = document.getElementById(`comprobante-render-${factura.id}`);
    if (!elemento) return;
    const opciones = {
      margin: 15,
      filename: `Comprobante_${factura.id.substring(0, 8)}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "letter", orientation: "portrait" }
    };
    elemento.style.display = "block";
    window.html2pdf().set(opciones).from(elemento).save().then(() => {
      elemento.style.display = "none";
    });
  };
  
  // ESTILOS OPTIMIZADOS PARA MÓVIL Y ESCRITORIO
  const styles = {
    authContainer: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#f8fafc", fontFamily: "sans-serif", padding: "16px", boxSizing: "border-box" },
    appLayout: { display: "flex", flexWrap: "wrap", minHeight: "100vh", backgroundColor: "#f8fafc", fontFamily: "sans-serif" },
    sidebar: { width: "100%", minWidth: "260px", flex: "1 1 260px", backgroundColor: "#0f172a", color: "#ffffff", display: "flex", flexDirection: "column", padding: "24px 16px", boxSizing: "border-box" },
    logoSection: { fontSize: "22px", fontWeight: "800", marginBottom: "24px", paddingLeft: "12px", letterSpacing: "-0.5px", display: "flex", alignItems: "baseline", gap: "6px" },
    versionTag: { fontSize: "9px", color: "#475569", fontWeight: "400", letterSpacing: "0px" },
    
    menuBtn: (activo) => ({
      width: "100%", padding: "12px 16px", borderRadius: "6px", border: "none", backgroundColor: activo ? "#1e293b" : "transparent",
      color: activo ? "#ffffff" : "#94a3b8", textAlign: "left", fontSize: "14px", fontWeight: "600", cursor: "pointer", marginBottom: "8px", transition: "all 0.2s"
    }),
    logoutBtn: { width: "100%", padding: "12px 16px", borderRadius: "6px", border: "1px solid #334155", backgroundColor: "transparent", color: "#f1f5f9", fontSize: "13px", fontWeight: "500", cursor: "pointer", marginTop: "16px" },
    mainContent: { flex: "1 1 300px", padding: "20px", boxSizing: "border-box" },
    card: { backgroundColor: "#ffffff", borderRadius: "8px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", padding: "20px", boxSizing: "border-box" },
    title: { fontSize: "20px", fontWeight: "700", color: "#0f172a", margin: "0 0 6px 0" },
    subtitle: { fontSize: "13px", color: "#64748b", margin: "0 0 24px 0" },
    field: { display: "flex", flexDirection: "column", marginBottom: "14px" },
    label: { fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "6px" },
    input: { width: "100%", padding: "10px 12px", fontSize: "13px", borderRadius: "6px", border: "1px solid #cbd5e1", boxSizing: "border-box" },
    row: { display: "flex", flexWrap: "wrap", gap: "16px" },
    sectionLabel: { fontSize: "11px", fontWeight: "700", color: "#475569", textTransform: "uppercase", margin: "24px 0 12px 0", paddingBottom: "6px", borderBottom: "1px solid #f1f5f9" },
    btnPrimary: { width: "100%", padding: "12px", fontSize: "13px", fontWeight: "600", color: "#ffffff", border: "none", borderRadius: "6px", cursor: "pointer", marginTop: "10px" },
    kpiGrid: { display: "flex", flexWrap: "wrap", gap: "16px", marginBottom: "24px" },
    kpiCard: { flex: "1 1 200px", backgroundColor: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "20px", boxShadow: "0 1px 2px rgba(0,0,0,0.02)" },
    kpiLabel: { fontSize: "12px", fontWeight: "600", color: "#64748b", textTransform: "uppercase", margin: 0 },
    kpiValue: { fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: "8px 0 0 0" },
    table: { width: "100%", borderCollapse: "collapse", fontSize: "13px" },
    th: { textAlign: "left", padding: "12px", backgroundColor: "#f8fafc", color: "#475569", fontWeight: "600", borderBottom: "1px solid #e2e8f0" },
    td: { padding: "14px 12px", borderBottom: "1px solid #f1f5f9", color: "#334155" },
    btnAction: { backgroundColor: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "4px", padding: "6px 12px", fontSize: "11px", fontWeight: "600", color: "#334155", cursor: "pointer", transition: "all 0.1s" }
  };
  
  if (cargandoAuth) {
    return <div style={styles.authContainer}><p style={{color: "#64748b", fontSize: "14px"}}>Cargando plataforma corporativa...</p></div>;
  }

  // PANTALLA DE ACCESO NO AUTENTICADO
  if (!usuario) {
    return (
      <div style={styles.authContainer}>
        <div style={{ width: "100%", maxWidth: "480px" }}>
          <div style={styles.card}>
            <h2 style={styles.title}>{modoRegistro ? "Crear Cuenta de Establecimiento" : "Control de Acceso Terminal"}</h2>
            <p style={styles.subtitle}>{modoRegistro ? "Inicialice una infraestructura aislada de datos contables." : "Autentique para habilitar los canales operativos POS."}</p>
            <form onSubmit={ejecutarAuth}>
              {modoRegistro && (
                <div style={styles.field}>
                  <label style={styles.label}>Nombre de la Razón Social</label>
                  <input type="text" placeholder="Ej: Distribuidora Central" value={nombreNegocio} onChange={(e) => setNombreNegocio(e.target.value)} style={styles.input} required />
                </div>
              )}
              <div style={styles.field}>
                <label style={styles.label}>Usuario / Correo Electrónico</label>
                <input type="email" placeholder="admin@negocio.com" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} style={styles.input} required />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Clave Corporativa de Acceso</label>
                <input type="password" placeholder="••••••••" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} style={styles.input} required />
              </div>
              <button type="submit" disabled={procesandoAccion} style={{...styles.btnPrimary, backgroundColor: "#0f172a"}}>
                {procesandoAccion ? "Autenticando..." : modoRegistro ? "Completar Registro" : "Iniciar Sesión"}
              </button>
            </form>
            <p style={{textAlign: "center", fontSize: "12px", color: "#64748b", marginTop: "20px", cursor: "pointer", textDecoration: "underline"}} onClick={() => setModoRegistro(!modoRegistro)}>
              {modoRegistro ? "¿Cuenta existente? Ingrese aquí" : "¿Nuevo establecimiento? Regístrelo aquí"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // INTERCEPCIÓN OPERATIVA POR MOROSIDAD / ACCESO SUSPENDIDO
  if (!negocioActivo) {
    return (
      <div style={styles.authContainer}>
        <div style={{ ...styles.card, maxWidth: "500px", textAlign: "center", border: "1px solid #ef4444" }}>
          <h2 style={{ ...styles.title, color: "#b91c1c" }}>Acceso Suspendido Temporalmente</h2>
          <p style={{ ...styles.subtitle, marginTop: "10px", lineHeight: "1.5" }}>
            Detectamos un pendiente en el pago de la suscripción de su establecimiento. Su infraestructura y registros contables se encuentran a salvo en la red, pero el acceso a la consola operativa ha sido congelado.
          </p>
          <p style={{ fontSize: "14px", fontWeight: "600", color: "#334155", margin: "20px 0" }}>
            Por favor, comuníquese con el administrador del sistema para restablecer el servicio.
          </p>
          <button onClick={cerrarSesion} style={{ ...styles.btnPrimary, backgroundColor: "#0f172a" }}>
            Volver al Inicio / Cambiar de Cuenta
          </button>
        </div>
      </div>
    );
  }

  // PANTALLA PRINCIPAL DEL SISTEMA
  return (
    <div style={styles.appLayout}>
      
      {/* SIDEBAR */}
      <div style={styles.sidebar}>
        <div style={styles.logoSection}>
          Soldi 
          <span style={styles.versionTag}>1.1</span>
        </div>
        
        <button onClick={() => setSeccionActiva("dashboard")} style={styles.menuBtn(seccionActiva === "dashboard")}>
          Dashboard Financiero
        </button>
        <button onClick={() => setSeccionActiva("registrar")} style={styles.menuBtn(seccionActiva === "registrar")}>
          Registrar Venta (POS)
        </button>
        <button onClick={() => setSeccionActiva("historial")} style={styles.menuBtn(seccionActiva === "historial")}>
          Histórico de Ventas
        </button>

        <button onClick={cerrarSesion} style={styles.logoutBtn}>
          Cerrar Caja Terminal
        </button>
      </div>

      {/* CONTENIDO VARIABLE */}
      <div style={styles.mainContent}>
        
        {/* SECCIÓN 1: DASHBOARD */}
        {seccionActiva === "dashboard" && (
          <div>
            <h1 style={styles.title}>Resumen de Operación Comercial</h1>
            <p style={styles.subtitle}>Métricas consolidadas del periodo de facturación activo.</p>
            
            <div style={styles.kpiGrid}>
              <div style={styles.kpiCard}>
                <p style={styles.kpiLabel}>Facturación del Mes (Bruto)</p>
                <h3 style={styles.kpiValue}>
                  ${Number(metricasMes.total_ventas || 0).toLocaleString("es-CO", { minimumFractionDigits: 2 })}
                </h3>
              </div>
              <div style={styles.kpiCard}>
                <p style={styles.kpiLabel}>Volumen de Transacciones</p>
                <h3 style={styles.kpiValue}>{metricasMes.cantidad_transacciones || 0} operaciones</h3>
              </div>
            </div>

            <div style={{...styles.card, textAlign: "center", padding: "40px 20px", backgroundColor: "#f8fafc"}}>
              <p style={{color: "#475569", fontWeight: "600", margin: 0}}>Terminal de Facturación Conectada</p>
              <p style={{color: "#64748b", fontSize: "13px", marginTop: "6px"}}>Utilice el menú lateral de navegación para gestionar las operaciones y auditorías del establecimiento.</p>
            </div>
          </div>
        )}

        {/* SECCIÓN 2: REGISTRAR VENTA */}
        {seccionActiva === "registrar" && (
          <div style={{maxWidth: "580px"}}>
            <div style={styles.card}>
              <h2 style={styles.title}>Emisión de Documento Comercial</h2>
              <p style={styles.subtitle}>Estructuración de comprobantes internos o facturas electrónicas de venta.</p>
              
              <form onSubmit={registrarVenta}>
                <div style={styles.field}>
                  <label style={styles.label}>Tipo de Comprobante</label>
                  <select value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)} style={{...styles.input, backgroundColor: "#f8fafc", fontWeight: "600"}}>
                    <option value="Recibo Interno">Comprobante de Venta Interno (No Contribuyente)</option>
                    <option value="Factura Electrónica">Factura Electrónica de Venta (DIAN)</option>
                  </select>
                </div>

                <div style={styles.sectionLabel}>Información del Adquirente</div>
                <div style={styles.row}>
                  <div style={{...styles.field, flex: 1}}><label style={styles.label}>Número de Identificación</label><input type="text" placeholder="NIT o Cédula" value={identificacion} onChange={(e) => setIdentificacion(e.target.value)} style={styles.input} required={tipoDoc === "Factura Electrónica"} /></div>
                  <div style={{...styles.field, flex: 1}}><label style={styles.label}>Razón Social / Nombre Completo</label><input type="text" placeholder="Nombre del adquirente" value={nombreCliente} onChange={(e) => setNombreCliente(e.target.value)} style={styles.input} required={tipoDoc === "Factura Electrónica"} /></div>
                </div>
                
                {/* NUEVO: Campo de Correo y Celular agrupados */}
                <div style={styles.row}>
                  <div style={{...styles.field, flex: 1}}>
                    <label style={styles.label}>Correo de Notificación</label>
                    <input type="email" placeholder="cliente@correo.com" value={correoCliente} onChange={(e) => setCorreoCliente(e.target.value)} style={styles.input} required={tipoDoc === "Factura Electrónica"} />
                  </div>
                  <div style={{...styles.field, flex: 1}}>
                    <label style={styles.label}>Celular (Opcional)</label>
                    <input type="tel" placeholder="Ej: 3001234567" value={celularCliente} onChange={(e) => setCelularCliente(e.target.value)} style={styles.input} />
                  </div>
                </div>

                <div style={styles.sectionLabel}>Desglose Financiero e Impuestos</div>
                <div style={styles.field}>
                  <label style={styles.label}>Concepto Comercial</label>
                  <input type="text" placeholder="Detalle del servicio o bien suministrado" value={concepto} onChange={(e) => setConcepto(e.target.value)} style={styles.input} required />
                </div>
                <div style={styles.row}>
                  <div style={{...styles.field, flex: 1}}><label style={styles.label}>Precio Venta Público ($)</label><input type="number" placeholder="0.00" value={monto} onChange={(e) => setMonto(e.target.value)} style={styles.input} required /></div>
                  
                  <div style={{...styles.field, flex: 1}}>
                    <label style={styles.label}>Clasificación Tributaria (IVA)</label>
                    <select value={tarifaIva} onChange={(e) => setTarifaIva(e.target.value)} style={styles.input}>
                      <option value="0">Exento / Excluido (0%)</option>
                      <option value="19">Tarifa General (19%)</option>
                      <option value="5">Tarifa Especial (5%)</option>
                    </select>
                  </div>
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Canal de Pago Homologado</label>
                  <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)} style={styles.input}>
                    <option value="Efectivo">Efectivo</option><option value="Nequi">Nequi</option><option value="Daviplata">Daviplata</option><option value="Bancolombia">Transferencia</option><option value="Tarjeta">Tarjeta Bancaria</option>
                  </select>
                </div>

                <button type="submit" disabled={procesandoAccion} style={{...styles.btnPrimary, backgroundColor: tipoDoc === "Factura Electrónica" ? "#0284c7" : "#0f172a"}}>
                  {procesandoAccion ? "Sincronizando Base de Datos..." : "Procesar y Emitir Documento"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* SECCIÓN 3: HISTÓRICO DE VENTAS */}
        {seccionActiva === "historial" && (
          <div style={styles.card}>
            <h1 style={styles.title}>Historial de Transacciones Consolidadas</h1>
            <p style={styles.subtitle}>Registro y auditoría cronológica de comprobantes emitidos en el establecimiento.</p>
            
            {facturas.length === 0 ? (
              <p style={{fontSize: "13px", color: "#64748b", textAlign: "center", padding: "24px 0"}}>No se registran operaciones previas en este establecimiento.</p>
            ) : (
              <>
                <div style={{ width: "100%", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Concepto Comercial</th>
                        <th style={styles.th}>Adquirente</th>
                        <th style={styles.th}>Medio</th>
                        <th style={{...styles.th, textAlign: "right", paddingRight: "12px"}}>Monto Total</th>
                        <th style={{...styles.th, textAlign: "center"}}>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {facturas.map((factura) => (
                        <tr key={factura.id}>
                          <td style={styles.td}>
                            <div style={{fontWeight: "600", color: "#0f172a"}}>{factura.venta.concepto}</div>
                            <span style={{
                              fontSize: "11px", fontWeight: "600", padding: "2px 6px", borderRadius: "4px",
                              backgroundColor: factura.tipo_documento === "Factura Electrónica" ? "#e0f2fe" : "#f1f5f9",
                              color: factura.tipo_documento === "Factura Electrónica" ? "#0369a1" : "#475569"
                            }}>
                              {factura.tipo_documento === "Factura Electrónica" ? "Factura Electrónica" : "Recibo Interno"}
                            </span>
                          </td>
                          <td style={styles.td}>
                            <div style={{fontWeight: "500"}}>{factura.cliente.nombre}</div>
                            <div style={{fontSize: "11px", color: "#64748b"}}>{factura.cliente.identificacion}</div>
                          </td>
                          <td style={styles.td}>
                            <span style={{fontSize: "12px", backgroundColor: "#f1f5f9", padding: "4px 8px", borderRadius: "4px"}}>
                              {factura.venta.metodo_pago}
                            </span>
                          </td>
                          <td style={{...styles.td, textAlign: "right", fontWeight: "700", color: "#0f172a", fontSize: "14px"}}>
                            ${Number(factura.venta.monto_total).toLocaleString("es-CO")}
                          </td>
                          <td style={{...styles.td, textAlign: "center"}}>
                            <button 
                              onClick={() => descargarPDF(factura)}
                              style={styles.btnAction}
                            >
                              Descargar PDF
                            </button>

                            {/* PLANTILLA DE COMPROBANTE OCULTA */}
                            <div 
                              id={`comprobante-render-${factura.id}`} 
                              style={{ 
                                display: "none", 
                                fontFamily: "sans-serif", 
                                color: "#0f172a", 
                                padding: "20px",
                                backgroundColor: "#ffffff"
                              }}
                            >
                              <div style={{ borderBottom: "2px solid #0f172a", paddingBottom: "15px", marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div>
                                  <h1 style={{ fontSize: "24px", fontWeight: "800", margin: 0, color: "#0f172a" }}>SOLDI</h1>
                                  <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0 0" }}>Plataforma de Control Comercial</p>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <h2 style={{ fontSize: "14px", fontWeight: "700", margin: 0, color: "#475569" }}>{factura.tipo_documento.toUpperCase()}</h2>
                                  <p style={{ fontSize: "11px", color: "#64748b", margin: "2px 0 0 0" }}>ID: {factura.id.toUpperCase()}</p>
                                </div>
                              </div>

                              <div style={{ marginBottom: "25px", display: "flex", gap: "40px" }}>
                                <div style={{ flex: 1 }}>
                                  <h3 style={{ fontSize: "11px", textTransform: "uppercase", color: "#64748b", margin: "0 0 6px 0", borderBottom: "1px solid #e2e8f0", paddingBottom: "4px" }}>Información del Adquirente</h3>
                                  <p style={{ fontSize: "13px", fontWeight: "700", margin: "0 0 2px 0" }}>{factura.cliente.nombre}</p>
                                  <p style={{ fontSize: "12px", margin: "0 0 2px 0" }}>NIT/Cédula: {factura.cliente.identificacion}</p>
                                  <p style={{ fontSize: "12px", margin: 0 }}>
                                    Correo: {factura.cliente.correo} 
                                    {factura.cliente.celular && factura.cliente.celular !== "N/A" ? ` | Tel: ${factura.cliente.celular}` : ""}
                                  </p>

                                </div>
                                <div style={{ flex: 1 }}>
                                  <h3 style={{ fontSize: "11px", textTransform: "uppercase", color: "#64748b", margin: "0 0 6px 0", borderBottom: "1px solid #e2e8f0", paddingBottom: "4px" }}>Detalles de la Transacción</h3>
                                  <p style={{ fontSize: "12px", margin: "0 0 4px 0" }}><strong>Fecha de Emisión:</strong> {factura.fecha_creacion?.seconds ? new Date(factura.fecha_creacion.seconds * 1000).toLocaleString("es-CO") : new Date().toLocaleString("es-CO")}</p>
                                  <p style={{ fontSize: "12px", margin: "0 0 4px 0" }}><strong>Canal de Liquidación:</strong> {factura.venta.metodo_pago}</p>
                                  <p style={{ fontSize: "12px", margin: 0 }}><strong>Estado DIAN:</strong> {factura.estado_dian}</p>
                                </div>
                              </div>

                              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "20px" }}>
                                <thead>
                                  <tr>
                                    <th style={{ textAlign: "left", padding: "10px", backgroundColor: "#f8fafc", fontSize: "12px", fontWeight: "700", borderBottom: "2px solid #cbd5e1" }}>Concepto / Descripción</th>
                                    <th style={{ textAlign: "center", padding: "10px", backgroundColor: "#f8fafc", fontSize: "12px", fontWeight: "700", borderBottom: "2px solid #cbd5e1" }}>Tarifa IVA</th>
                                    <th style={{ textAlign: "right", padding: "10px", backgroundColor: "#f8fafc", fontSize: "12px", fontWeight: "700", borderBottom: "2px solid #cbd5e1", width: "120px" }}>Base Gravable</th>
                                    <th style={{ textAlign: "right", padding: "10px", backgroundColor: "#f8fafc", fontSize: "12px", fontWeight: "700", borderBottom: "2px solid #cbd5e1", width: "120px" }}>Valor Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    <td style={{ padding: "12px 10px", fontSize: "13px", borderBottom: "1px solid #e2e8f0", color: "#334155" }}>{factura.venta.concepto}</td>
                                    <td style={{ padding: "12px 10px", fontSize: "13px", borderBottom: "1px solid #e2e8f0", textAlign: "center" }}>{factura.venta.porcentaje_iva ?? 0}%</td>
                                    <td style={{ padding: "12px 10px", fontSize: "13px", borderBottom: "1px solid #e2e8f0", textAlign: "right" }}>${Number(factura.venta.base_gravable ?? factura.venta.monto_total).toLocaleString("es-CO", { minimumFractionDigits: 2 })}</td>
                                    <td style={{ padding: "12px 10px", fontSize: "13px", borderBottom: "1px solid #e2e8f0", textAlign: "right", fontWeight: "600" }}>${Number(factura.venta.monto_total).toLocaleString("es-CO", { minimumFractionDigits: 2 })}</td>
                                  </tr>
                                  <tr>
                                    <td colSpan="2" style={{ padding: "6px 10px", textAlign: "right", fontSize: "12px", color: "#64748b" }}>Subtotal Neto (Base):</td>
                                    <td colSpan="2" style={{ padding: "6px 10px", textAlign: "right", fontSize: "12px", fontWeight: "600" }}>${Number(factura.venta.base_gravable ?? factura.venta.monto_total).toLocaleString("es-CO", { minimumFractionDigits: 2 })}</td>
                                  </tr>
                                  <tr>
                                    <td colSpan="2" style={{ padding: "6px 10px", textAlign: "right", fontSize: "12px", color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>Impuesto Liquidado (IVA):</td>
                                    <td colSpan="2" style={{ padding: "6px 10px", textAlign: "right", fontSize: "12px", fontWeight: "600", borderBottom: "1px solid #e2e8f0" }}>${Number(factura.venta.valor_iva ?? 0).toLocaleString("es-CO", { minimumFractionDigits: 2 })}</td>
                                  </tr>
                                  <tr>
                                    <td colSpan="2" style={{ padding: "15px 10px", textAlign: "right", fontWeight: "700", fontSize: "13px" }}>Monto Total Recibido:</td>
                                    <td colSpan="2" style={{ padding: "15px 10px", textAlign: "right", fontWeight: "800", fontSize: "16px", color: "#0f172a" }}>${Number(factura.venta.monto_total).toLocaleString("es-CO", { minimumFractionDigits: 2 })}</td>
                                  </tr>
                                </tbody>
                              </table>

                              <div style={{ marginTop: "50px", textAlign: "center", borderTop: "1px dashed #cbd5e1", paddingTop: "15px" }}>
                                <p style={{ fontSize: "11px", color: "#64748b", margin: 0 }}>Este documento constituye un soporte contable digital emitido de forma válida.</p>
                                <p style={{ fontSize: "10px", color: "#94a3b8", marginTop: "4px" }}>Generado automáticamente por la infraestructura de red de Soldi v1.1.</p>
                              </div>
                            </div>

                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {hayMasFacturas && (
                  <button 
                    onClick={cargarMasFacturas} 
                    disabled={cargandoHistorial}
                    style={{
                      width: "100%", backgroundColor: "#ffffff", border: "1px solid #cbd5e1", padding: "12px",
                      borderRadius: "6px", fontSize: "12px", color: "#475569", fontWeight: "600", cursor: "pointer", marginTop: "20px"
                    }}
                  >
                    {cargandoHistorial ? "Consultando base de datos..." : "Cargar registros históricos adicionales"}
                  </button>
                )}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

export default App;