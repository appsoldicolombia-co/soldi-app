import { useState, useEffect } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "firebase/auth";
import {
  doc, collection, writeBatch, increment, onSnapshot,
  query, orderBy, limit, getDocs, startAfter,
  setDoc, addDoc, deleteDoc, where, getDoc, arrayUnion
} from "firebase/firestore";
import { db, auth } from "./firebase";

// ─── utilidades de tiempo ─────────────────────────────────────────────────────
const toMin = (t) => parseInt(t.split(":")[0]) * 60 + parseInt(t.split(":")[1]);
const toStr = (m) => `${String(Math.floor(m / 60)).padStart(2,"0")}:${String(m % 60).padStart(2,"0")}`;
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const nombreDia = (ds) => ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"][new Date(ds+"T12:00:00").getDay()];
const fechaLarga = (ds) => new Date(ds+"T12:00:00").toLocaleDateString("es-CO",{weekday:"long",day:"numeric",month:"long"});
const hora12 = (t) => { const [h,m]=t.split(":").map(Number); return `${h%12||12}:${String(m).padStart(2,"0")} ${h>=12?"pm":"am"}`; };
const periodoActual = () => { const d=new Date(); return `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,"0")}`; };

const generarSlots = (config, citas, duracion) => {
  const dur = Number(duracion) || 30;
  let cursor = toMin(config.hora_inicio || "08:00");
  const fin = toMin(config.hora_fin || "18:00");
  const activas = citas.filter(c => c.estado !== "cancelada");
  const slots = [];
  while (cursor + dur <= fin) {
    const hi = toStr(cursor), hf = toStr(cursor + dur);
    const ocupado = activas.some(c => cursor < toMin(c.hora_fin) && cursor + dur > toMin(c.hora_inicio));
    slots.push({ horaInicio: hi, horaFin: hf, ocupado });
    cursor += dur;
  }
  return slots;
};

// ─── componente principal ─────────────────────────────────────────────────────
function App() {

  // dark mode
  const [darkMode, setDarkMode] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = e => setDarkMode(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  // responsive
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [menuAbierto, setMenuAbierto] = useState(false);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  // auth / negocio
  const [usuario, setUsuario] = useState(null);
  const [negocioActivo, setNegocioActivo] = useState(true);
  const [cargandoAuth, setCargandoAuth] = useState(true);
  const [procesandoAccion, setProcesandoAccion] = useState(false);
  const [modoRegistro, setModoRegistro] = useState(false);

  // navegación
  const [seccionActiva, setSeccionActiva] = useState("dashboard");

  // métricas
  const [metricasMes, setMetricasMes] = useState({ total_ventas: 0, cantidad_transacciones: 0 });

  // dashboard analytics
  const [dashPeriodo, setDashPeriodo] = useState("mes"); // "dia" | "semana" | "mes"
  const [dashMes, setDashMes] = useState(() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; });
  const [dashFecha, setDashFecha] = useState(hoy);
  const [facturasDash, setFacturasDash] = useState([]);
  const [cargandoDash, setCargandoDash] = useState(false);

  // cobro rápido desde agenda
  const [citaACobrar, setCitaACobrar] = useState(null);
  const [cobrarMetodo, setCobrarMetodo] = useState("Efectivo");
  const [cobrarMonto, setCobrarMonto] = useState("");
  const [cobrandoCita, setCobrandoCita] = useState(false);

  // historial
  const [facturas, setFacturas] = useState([]);
  const [ultimoDoc, setUltimoDoc] = useState(null);
  const [hayMasFacturas, setHayMasFacturas] = useState(true);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  // forms auth / pos
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [nombreNegocio, setNombreNegocio] = useState("");
  const [tipoDoc, setTipoDoc] = useState("Recibo Interno");
  const [identificacion, setIdentificacion] = useState("");
  const [nombreCliente, setNombreCliente] = useState("");
  const [correoCliente, setCorreoCliente] = useState("");
  const [celularCliente, setCelularCliente] = useState("");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [metodoPago, setMetodoPago] = useState("Efectivo");
  const [tarifaIva, setTarifaIva] = useState("0");

  // catálogo de servicios
  const [servicios, setServicios] = useState([]);
  const [nuevoServicio, setNuevoServicio] = useState({ nombre: "", precio: "", duracion: "30" });
  const [guardandoServicio, setGuardandoServicio] = useState(false);

  // profesionales
  const [profesionales, setProfesionales] = useState([]);
  const [nuevoProfesional, setNuevoProfesional] = useState({ nombre: "", especialidad: "" });
  const [guardandoProfesional, setGuardandoProfesional] = useState(false);

  // config agenda
  const [configAgenda, setConfigAgenda] = useState({ hora_inicio: "08:00", hora_fin: "18:00", dias_activos: ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"] });
  const [guardandoConfig, setGuardandoConfig] = useState(false);

  // agenda – estado compartido entre tabs
  const [fechaAgenda, setFechaAgenda] = useState(hoy);
  const [citasDelDia, setCitasDelDia] = useState([]);
  const [cargandoCitas, setCargandoCitas] = useState(false);
  const [tabAgenda, setTabAgenda] = useState(0); // 0=ver 1=nueva 2=publico
  const [filtroProfAgenda, setFiltroProfAgenda] = useState("todos");

  // agenda – form nueva cita
  const [ncServicioId, setNcServicioId] = useState("");
  const [ncProfId, setNcProfId] = useState("");
  const [ncSlot, setNcSlot] = useState(null);
  const [ncNombre, setNcNombre] = useState("");
  const [ncCelular, setNcCelular] = useState("");
  const [guardandoNc, setGuardandoNc] = useState(false);

  // booking público
  const [modoPublico, setModoPublico] = useState(false);
  const [pubUid, setPubUid] = useState("");
  const [pubNegocioNombre, setPubNegocioNombre] = useState("");
  const [pubServicios, setPubServicios] = useState([]);
  const [pubProfesionales, setPubProfesionales] = useState([]);
  const [pubConfig, setPubConfig] = useState({ hora_inicio: "08:00", hora_fin: "18:00", dias_activos: [] });
  const [pubCitasDia, setPubCitasDia] = useState([]);
  const [pubCargando, setPubCargando] = useState(false);
  const [pubStep, setPubStep] = useState(1);
  const [pubServicioId, setPubServicioId] = useState("");
  const [pubProfId, setPubProfId] = useState("");
  const [pubFecha, setPubFecha] = useState(hoy);
  const [pubSlot, setPubSlot] = useState(null);
  const [pubNombre, setPubNombre] = useState("");
  const [pubCelular, setPubCelular] = useState("");
  const [pubConfirmada, setPubConfirmada] = useState(false);
  const [pubReservando, setPubReservando] = useState(false);
  const [pubReglasError, setPubReglasError] = useState(false);
  const [pubTagline, setPubTagline] = useState("");
  const [pubLogoUrl, setPubLogoUrl] = useState("");

  // perfil del negocio (dueño)
  const [perfilNegocio, setPerfilNegocio] = useState({ nombre_comercial: "", tagline: "", logo_url: "" });
  const [guardandoPerfil, setGuardandoPerfil] = useState(false);

  // tipo de negocio y admin
  const [tipoNegocio, setTipoNegocio] = useState("barberia");
  const [esAdmin, setEsAdmin] = useState(false);
  const [negociosList, setNegociosList] = useState([]);
  const [cargandoNegocios, setCargandoNegocios] = useState(false);

  // valeras (restaurante)
  const [valeras, setValeras] = useState([]);
  const [nuevaValera, setNuevaValera] = useState({ nombre: "", celular: "", cantidad: "10" });
  const [guardandoValera, setGuardandoValera] = useState(false);
  const [recargaVal, setRecargaVal] = useState({});
  const [valeraHistOpen, setValeraHistOpen] = useState({});

  // fiar (tienda)
  const [fiados, setFiados] = useState([]);
  const [nuevoFiado, setNuevoFiado] = useState({ nombre: "", celular: "" });
  const [guardandoFiado, setGuardandoFiado] = useState(false);
  const [fiadoAbierto, setFiadoAbierto] = useState(null);
  const [movFiado, setMovFiado] = useState({ tipo: "cargo", concepto: "", monto: "" });
  const [guardandoMovFiado, setGuardandoMovFiado] = useState(false);
  const [movimientos, setMovimientos] = useState([]);
  const [cargandoMovs, setCargandoMovs] = useState(false);

  // ── detectar modo público ──────────────────────────────────────────────────
  useEffect(() => {
    const bid = new URLSearchParams(window.location.search).get("b");
    if (bid) { setModoPublico(true); setPubUid(bid); }
  }, []);

  // ── cargar datos públicos cuando se conoce el uid ─────────────────────────
  useEffect(() => {
    if (!pubUid) return;
    const load = async () => {
      setPubCargando(true);
      setPubReglasError(false);
      let errores = 0;

      // Cada fetch es independiente: si falla uno no bloquea los demás
      try {
        const s = await getDoc(doc(db, "negocios", pubUid));
        if (s.exists()) {
          const d = s.data();
          setPubNegocioNombre(d.nombre_comercial || "");
          setPubTagline(d.tagline || "");
          setPubLogoUrl(d.logo_url || "");
        }
      } catch (e) { console.error("Error leyendo negocio:", e); errores++; }

      try {
        const s = await getDocs(query(collection(db, `negocios/${pubUid}/servicios`), orderBy("nombre")));
        setPubServicios(s.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) { console.error("Error leyendo servicios (¿Reglas Firestore?):", e); errores++; }

      try {
        const s = await getDocs(query(collection(db, `negocios/${pubUid}/profesionales`), orderBy("nombre")));
        setPubProfesionales(s.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) { console.error("Error leyendo profesionales:", e); errores++; }

      try {
        const s = await getDoc(doc(db, `negocios/${pubUid}/configuracion`, "agenda"));
        if (s.exists()) setPubConfig(s.data());
      } catch (e) { console.error("Error leyendo config:", e); errores++; }

      if (errores > 0) setPubReglasError(true);
      setPubCargando(false);
    };
    load();
  }, [pubUid]);

  // ── cargar citas públicas cuando cambia la fecha del booking ──────────────
  useEffect(() => {
    if (!pubUid || !pubFecha) return;
    getDocs(query(collection(db, `negocios/${pubUid}/citas`), where("fecha","==",pubFecha)))
      .then(snap => setPubCitasDia(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(console.error);
  }, [pubUid, pubFecha]);

  // ── suscripciones del propietario ─────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setUsuario(user);
      if (user) {
        const isAdminUser = user.email === "admin@soldi.co";
        setEsAdmin(isAdminUser);

        if (isAdminUser) {
          setNegocioActivo(true);
          setCargandoAuth(false);
          setCargandoNegocios(true);
          getDocs(collection(db, "negocios"))
            .then(snap => setNegociosList(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
            .catch(console.error)
            .finally(() => setCargandoNegocios(false));
          return;
        }

        const u1 = onSnapshot(doc(db, "negocios", user.uid), (s) => {
          const data = s.data() || {};
          setNegocioActivo(s.exists() ? data.activo !== false : true);
          setTipoNegocio(data.tipo_negocio || "barberia");
          setPerfilNegocio({
            nombre_comercial: data.nombre_comercial || "",
            tagline: data.tagline || "",
            logo_url: data.logo_url || ""
          });
          setCargandoAuth(false);
        }, () => { setNegocioActivo(true); setCargandoAuth(false); });

        const u2 = onSnapshot(doc(db, `negocios/${user.uid}/metricas`, periodoActual()), (s) => {
          setMetricasMes(s.exists() ? s.data() : { total_ventas: 0, cantidad_transacciones: 0 });
        }, console.error);

        const u3 = onSnapshot(query(collection(db, `negocios/${user.uid}/servicios`), orderBy("nombre")), (s) => {
          setServicios(s.docs.map(d => ({ id: d.id, ...d.data() })));
        }, console.error);

        const u4 = onSnapshot(query(collection(db, `negocios/${user.uid}/profesionales`), orderBy("nombre")), (s) => {
          setProfesionales(s.docs.map(d => ({ id: d.id, ...d.data() })));
        }, console.error);

        const u5 = onSnapshot(doc(db, `negocios/${user.uid}/configuracion`, "agenda"), (s) => {
          if (s.exists()) setConfigAgenda(s.data());
        }, console.error);

        const u6 = onSnapshot(query(collection(db, `negocios/${user.uid}/valeras`), orderBy("cliente_nombre")), (s) => {
          setValeras(s.docs.map(d => ({ id: d.id, ...d.data() })));
        }, console.error);

        const u7 = onSnapshot(query(collection(db, `negocios/${user.uid}/fiados`), orderBy("cliente_nombre")), (s) => {
          setFiados(s.docs.map(d => ({ id: d.id, ...d.data() })));
        }, console.error);

        cargarPrimerasFacturas(user.uid);
        return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); };
      } else { setCargandoAuth(false); }
    });
    return () => unsub();
  }, [usuario]);

  // ── cargar citas del día (propietario) ────────────────────────────────────
  useEffect(() => {
    if (!usuario || seccionActiva !== "agenda") return;
    setCargandoCitas(true);
    setNcSlot(null);
    getDocs(query(collection(db, `negocios/${usuario.uid}/citas`), where("fecha","==",fechaAgenda)))
      .then(snap => setCitasDelDia(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(console.error)
      .finally(() => setCargandoCitas(false));
  }, [usuario, fechaAgenda, seccionActiva]);

  // ── dashboard analytics ──────────────────────────────────────────────────
  const cargarDashboard = async (periodo, fecha, mes, uid) => {
    const u = uid || usuario?.uid;
    if (!u) return;
    setCargandoDash(true);
    try {
      let inicio, fin;
      if (periodo === "dia") {
        const [y,m,d] = fecha.split("-").map(Number);
        inicio = new Date(y, m-1, d);
        fin    = new Date(y, m-1, d+1);
      } else if (periodo === "semana") {
        const [y,m,d] = fecha.split("-").map(Number);
        const base = new Date(y, m-1, d);
        const diff = base.getDay()===0 ? -6 : 1-base.getDay();
        inicio = new Date(base); inicio.setDate(inicio.getDate()+diff);
        fin    = new Date(inicio); fin.setDate(fin.getDate()+7);
      } else {
        const [y,m] = mes.split("-").map(Number);
        inicio = new Date(y, m-1, 1);
        fin    = new Date(y, m,   1);
      }
      const snap = await getDocs(query(
        collection(db, `negocios/${u}/facturas`),
        where("fecha_creacion",">=", inicio),
        where("fecha_creacion","<",  fin),
        orderBy("fecha_creacion","desc")
      ));
      setFacturasDash(snap.docs.map(d => ({ id:d.id,...d.data() })));
    } catch(e){ console.error(e); } finally { setCargandoDash(false); }
  };

  // cargar dashboard al entrar a la sección o cambiar filtros
  useEffect(() => {
    if (seccionActiva === "dashboard" && usuario && !esAdmin) {
      cargarDashboard(dashPeriodo, dashFecha, dashMes);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seccionActiva, dashPeriodo, dashFecha, dashMes, usuario]);

  // ── historial ────────────────────────────────────────────────────────────
  const cargarPrimerasFacturas = async (uid) => {
    setCargandoHistorial(true);
    try {
      const snap = await getDocs(query(collection(db,`negocios/${uid}/facturas`), orderBy("fecha_creacion","desc"), limit(10)));
      setFacturas(snap.empty ? [] : snap.docs.map(d => ({ id:d.id,...d.data() })));
      setUltimoDoc(snap.empty ? null : snap.docs[snap.docs.length-1]);
      setHayMasFacturas(snap.docs.length === 10);
    } catch(e){ console.error(e); } finally { setCargandoHistorial(false); }
  };

  const cargarMasFacturas = async () => {
    if (!usuario || !ultimoDoc || cargandoHistorial) return;
    setCargandoHistorial(true);
    try {
      const snap = await getDocs(query(collection(db,`negocios/${usuario.uid}/facturas`), orderBy("fecha_creacion","desc"), startAfter(ultimoDoc), limit(10)));
      if (!snap.empty) {
        setFacturas(prev => [...prev, ...snap.docs.map(d=>({id:d.id,...d.data()}))]);
        setUltimoDoc(snap.docs[snap.docs.length-1]);
        setHayMasFacturas(snap.docs.length === 10);
      } else { setHayMasFacturas(false); }
    } catch(e){ console.error(e); } finally { setCargandoHistorial(false); }
  };

  // ── auth ─────────────────────────────────────────────────────────────────
  const ejecutarAuth = async (e) => {
    e.preventDefault(); setProcesandoAccion(true);
    try {
      if (modoRegistro) {
        const { user } = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        const batch = writeBatch(db);
        batch.set(doc(db,"negocios",user.uid),{ nombre_comercial:nombreNegocio, fecha_registro:new Date(), plan:"Gratuito", activo:true, tipo_negocio:"barberia" });
        await batch.commit();
        alert("Establecimiento registrado exitosamente.");
      } else { await signInWithEmailAndPassword(auth, authEmail, authPassword); }
      setAuthEmail(""); setAuthPassword(""); setNombreNegocio("");
    } catch { alert("Error de autenticación. Verifique sus credenciales."); }
    finally { setProcesandoAccion(false); }
  };

  const cerrarSesion = () => {
    signOut(auth);
    setMetricasMes({ total_ventas:0, cantidad_transacciones:0 });
    setFacturas([]); setUltimoDoc(null);
    setServicios([]); setProfesionales([]); setCitasDelDia([]);
    setSeccionActiva("dashboard"); setNegocioActivo(true);
    setEsAdmin(false); setNegociosList([]); setTipoNegocio("barberia");
    setValeras([]); setFiados([]); setFiadoAbierto(null); setMovimientos([]);
  };

  // ── POS ──────────────────────────────────────────────────────────────────
  const registrarVenta = async (e) => {
    e.preventDefault();
    if (!usuario || !negocioActivo) return;
    setProcesandoAccion(true);
    try {
      const total = Number(monto);
      const base = total / (1 + Number(tarifaIva)/100);
      const facturaData = {
        tipo_documento: tipoDoc,
        cliente: { identificacion: identificacion||"Consumidor Final", nombre: nombreCliente||"Cuantías Menores", correo: correoCliente||"N/A", celular: celularCliente||"N/A" },
        venta: { concepto, monto_total:total, base_gravable:+base.toFixed(2), valor_iva:+(total-base).toFixed(2), porcentaje_iva:Number(tarifaIva), metodo_pago:metodoPago },
        estado_dian: tipoDoc==="Factura Electrónica"?"Pendiente":"No aplica",
        fecha_creacion: new Date()
      };
      const batch = writeBatch(db);
      const ref = doc(collection(db,`negocios/${usuario.uid}/facturas`));
      batch.set(ref, facturaData);
      batch.set(doc(db,`negocios/${usuario.uid}/metricas`,periodoActual()), { total_ventas:increment(total), cantidad_transacciones:increment(1), ultima_actualizacion:new Date() },{ merge:true });
      await batch.commit();
      setFacturas(prev => [{ id:ref.id,...facturaData },...prev]);
      alert("Registro guardado con éxito.");
      setIdentificacion(""); setNombreCliente(""); setCorreoCliente(""); setCelularCliente("");
      setConcepto(""); setMonto(""); setTarifaIva("0");
    } catch { alert("Error al procesar la transacción."); }
    finally { setProcesandoAccion(false); }
  };

  const descargarPDF = (f) => {
    const el = document.getElementById(`cr-${f.id}`);
    if (!el) return;
    el.style.display = "block";
    window.html2pdf().set({ margin:15, filename:`Comprobante_${f.id.substring(0,8)}.pdf`, image:{type:"jpeg",quality:0.98}, html2canvas:{scale:2,useCORS:true}, jsPDF:{unit:"mm",format:"letter",orientation:"portrait"} }).from(el).save().then(()=>{ el.style.display="none"; });
  };

  // ── catálogo ──────────────────────────────────────────────────────────────
  const agregarServicio = async (e) => {
    e.preventDefault(); if (!usuario||!nuevoServicio.nombre.trim()) return;
    setGuardandoServicio(true);
    try {
      await addDoc(collection(db,`negocios/${usuario.uid}/servicios`),{ nombre:nuevoServicio.nombre.trim(), precio:Number(nuevoServicio.precio)||0, duracion:Number(nuevoServicio.duracion)||30, fecha_creacion:new Date() });
      setNuevoServicio({ nombre:"",precio:"",duracion:"30" });
    } catch { alert("Error al agregar el servicio."); }
    finally { setGuardandoServicio(false); }
  };

  const eliminarServicio = async (id) => {
    if (!usuario||!window.confirm("¿Eliminar este servicio?")) return;
    await deleteDoc(doc(db,`negocios/${usuario.uid}/servicios`,id)).catch(()=>alert("Error al eliminar."));
  };

  // ── profesionales ─────────────────────────────────────────────────────────
  const agregarProfesional = async (e) => {
    e.preventDefault(); if (!usuario||!nuevoProfesional.nombre.trim()) return;
    setGuardandoProfesional(true);
    try {
      await addDoc(collection(db,`negocios/${usuario.uid}/profesionales`),{ nombre:nuevoProfesional.nombre.trim(), especialidad:nuevoProfesional.especialidad.trim()||"", fecha_creacion:new Date() });
      setNuevoProfesional({ nombre:"",especialidad:"" });
    } catch (e) {
      console.error("Error al agregar profesional:", e);
      alert(`Error al agregar el profesional.\n\nCausa: ${e.code || e.message}\n\nSi dice "permission-denied", debe actualizar las Reglas de Firestore en la consola de Firebase.`);
    }
    finally { setGuardandoProfesional(false); }
  };

  const eliminarProfesional = async (id) => {
    if (!usuario||!window.confirm("¿Eliminar este profesional?")) return;
    await deleteDoc(doc(db,`negocios/${usuario.uid}/profesionales`,id)).catch(()=>alert("Error al eliminar."));
  };

  // ── admin ─────────────────────────────────────────────────────────────────
  const refrescarNegocios = async () => {
    setCargandoNegocios(true);
    try {
      const snap = await getDocs(collection(db, "negocios"));
      setNegociosList(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch(e) { console.error(e); }
    finally { setCargandoNegocios(false); }
  };

  const toggleActivoAdmin = async (uid, activo) => {
    await setDoc(doc(db, "negocios", uid), { activo: !activo }, { merge: true });
    setNegociosList(prev => prev.map(n => n.id === uid ? { ...n, activo: !activo } : n));
  };

  const cambiarTipoAdmin = async (uid, tipo) => {
    await setDoc(doc(db, "negocios", uid), { tipo_negocio: tipo }, { merge: true });
    setNegociosList(prev => prev.map(n => n.id === uid ? { ...n, tipo_negocio: tipo } : n));
  };

  // ── valeras (restaurante) ─────────────────────────────────────────────────
  const crearValera = async (e) => {
    e.preventDefault();
    if (!usuario || !nuevaValera.nombre.trim()) return;
    setGuardandoValera(true);
    try {
      await addDoc(collection(db, `negocios/${usuario.uid}/valeras`), {
        cliente_nombre: nuevaValera.nombre.trim(),
        cliente_celular: nuevaValera.celular.trim() || "N/A",
        saldo: Number(nuevaValera.cantidad) || 10,
        fecha_creacion: new Date()
      });
      setNuevaValera({ nombre: "", celular: "", cantidad: "10" });
    } catch(e) { alert("Error al crear valera: " + (e.code || e.message)); }
    finally { setGuardandoValera(false); }
  };

  const descontarAlmuerzo = async (v) => {
    if (v.saldo <= 0) return;
    const nuevoSaldo = v.saldo - 1;
    await setDoc(doc(db, `negocios/${usuario.uid}/valeras`, v.id), {
      saldo: nuevoSaldo,
      usos: arrayUnion({ fecha: new Date(), tipo: "descuento", cantidad: 1, saldo_resultante: nuevoSaldo })
    }, { merge: true });
  };

  const recargarValera = async (v) => {
    const cant = Number(recargaVal[v.id] || 0);
    if (cant <= 0) return;
    const nuevoSaldo = v.saldo + cant;
    await setDoc(doc(db, `negocios/${usuario.uid}/valeras`, v.id), {
      saldo: nuevoSaldo,
      usos: arrayUnion({ fecha: new Date(), tipo: "recarga", cantidad: cant, saldo_resultante: nuevoSaldo })
    }, { merge: true });
    setRecargaVal(prev => ({ ...prev, [v.id]: "" }));
  };

  const eliminarValera = async (id) => {
    if (!window.confirm("¿Eliminar esta valera?")) return;
    await deleteDoc(doc(db, `negocios/${usuario.uid}/valeras`, id));
  };

  // ── fiar (tienda) ─────────────────────────────────────────────────────────
  const crearFiado = async (e) => {
    e.preventDefault();
    if (!usuario || !nuevoFiado.nombre.trim()) return;
    setGuardandoFiado(true);
    try {
      await addDoc(collection(db, `negocios/${usuario.uid}/fiados`), {
        cliente_nombre: nuevoFiado.nombre.trim(),
        cliente_celular: nuevoFiado.celular.trim() || "N/A",
        deuda: 0,
        fecha_creacion: new Date()
      });
      setNuevoFiado({ nombre: "", celular: "" });
    } catch(e) { alert("Error: " + (e.code || e.message)); }
    finally { setGuardandoFiado(false); }
  };

  const abrirFiado = async (fiado) => {
    setFiadoAbierto(fiado);
    setCargandoMovs(true);
    try {
      const snap = await getDocs(query(collection(db, `negocios/${usuario.uid}/movimientos_fiar`), where("fiado_id", "==", fiado.id)));
      setMovimientos(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (b.fecha?.seconds||0) - (a.fecha?.seconds||0)));
    } catch(e) { console.error(e); }
    finally { setCargandoMovs(false); }
  };

  const agregarMovFiado = async () => {
    if (!usuario || !fiadoAbierto || !movFiado.monto) return;
    setGuardandoMovFiado(true);
    try {
      const monto = Number(movFiado.monto);
      const delta = movFiado.tipo === "cargo" ? monto : -monto;
      const nuevaDeuda = (fiadoAbierto.deuda || 0) + delta;
      await addDoc(collection(db, `negocios/${usuario.uid}/movimientos_fiar`), {
        fiado_id: fiadoAbierto.id,
        tipo: movFiado.tipo,
        concepto: movFiado.concepto.trim() || (movFiado.tipo === "cargo" ? "Fiado" : "Pago"),
        monto,
        fecha: new Date()
      });
      await setDoc(doc(db, `negocios/${usuario.uid}/fiados`, fiadoAbierto.id), { deuda: nuevaDeuda }, { merge: true });
      setFiadoAbierto(prev => ({ ...prev, deuda: nuevaDeuda }));
      setMovFiado({ tipo: "cargo", concepto: "", monto: "" });
      const snap = await getDocs(query(collection(db, `negocios/${usuario.uid}/movimientos_fiar`), where("fiado_id", "==", fiadoAbierto.id)));
      setMovimientos(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (b.fecha?.seconds||0) - (a.fecha?.seconds||0)));
    } catch(e) { alert("Error: " + (e.code || e.message)); }
    finally { setGuardandoMovFiado(false); }
  };

  const eliminarFiado = async (id) => {
    if (!window.confirm("¿Eliminar este fiado?")) return;
    await deleteDoc(doc(db, `negocios/${usuario.uid}/fiados`, id));
    if (fiadoAbierto?.id === id) setFiadoAbierto(null);
  };

  // ── configuración de agenda ───────────────────────────────────────────────
  const toggleDia = (dia) => setConfigAgenda(p => ({...p, dias_activos: p.dias_activos.includes(dia) ? p.dias_activos.filter(d=>d!==dia) : [...p.dias_activos,dia] }));

  // ── perfil del negocio ────────────────────────────────────────────────────
  const guardarPerfil = async (e) => {
    e.preventDefault(); if (!usuario) return;
    setGuardandoPerfil(true);
    try {
      await setDoc(doc(db, "negocios", usuario.uid), {
        nombre_comercial: perfilNegocio.nombre_comercial.trim(),
        tagline: perfilNegocio.tagline.trim(),
        logo_url: perfilNegocio.logo_url.trim()
      }, { merge: true });
      alert("Perfil del negocio actualizado.");
    } catch (e) {
      alert(`Error al guardar: ${e.code || e.message}`);
    }
    finally { setGuardandoPerfil(false); }
  };

  const guardarConfigAgenda = async (e) => {
    e.preventDefault(); if (!usuario) return;
    setGuardandoConfig(true);
    try {
      await setDoc(doc(db,`negocios/${usuario.uid}/configuracion`,"agenda"), configAgenda);
      alert("Configuración guardada.");
    } catch (e) {
      console.error("Error al guardar config:", e);
      alert(`Error al guardar la configuración.\n\nCausa: ${e.code || e.message}\n\nSi dice "permission-denied", debe actualizar las Reglas de Firestore en la consola de Firebase.`);
    }
    finally { setGuardandoConfig(false); }
  };

  // ── agendar cita (propietario) ────────────────────────────────────────────
  const reservarCitaManual = async () => {
    if (!usuario||!ncSlot||!ncNombre.trim()) return;
    const serv = servicios.find(s=>s.id===ncServicioId);
    const prof = profesionales.find(p=>p.id===ncProfId);
    setGuardandoNc(true);
    try {
      const data = {
        fecha: fechaAgenda, hora_inicio:ncSlot.horaInicio, hora_fin:ncSlot.horaFin,
        servicio_id:ncServicioId||"", servicio_nombre:serv?.nombre||"Sin especificar", servicio_duracion:serv?.duracion||30,
        profesional_id:ncProfId||"", profesional_nombre:prof?.nombre||"Sin asignar",
        cliente_nombre:ncNombre.trim(), cliente_celular:ncCelular||"N/A",
        estado:"confirmada", origen:"manual", fecha_creacion:new Date()
      };
      const ref = await addDoc(collection(db,`negocios/${usuario.uid}/citas`),data);
      setCitasDelDia(prev=>[...prev,{ id:ref.id,...data }]);
      setNcSlot(null); setNcNombre(""); setNcCelular("");
      setTabAgenda(0);
    } catch { alert("Error al reservar la cita."); }
    finally { setGuardandoNc(false); }
  };

  const cancelarCita = async (citaId) => {
    if (!usuario||!window.confirm("¿Cancelar esta cita?")) return;
    try {
      await setDoc(doc(db,`negocios/${usuario.uid}/citas`,citaId),{ estado:"cancelada" },{ merge:true });
      setCitasDelDia(prev=>prev.map(c=>c.id===citaId?{...c,estado:"cancelada"}:c));
    } catch { alert("Error al cancelar."); }
  };

  const cobrarCita = async () => {
    if (!usuario || !citaACobrar || !cobrarMonto) return;
    setCobrandoCita(true);
    try {
      const monto = Number(cobrarMonto);
      const facturaData = {
        tipo_documento:"Recibo Interno",
        cliente:{ nombre:citaACobrar.cliente_nombre, identificacion:"", correo:"", celular:citaACobrar.cliente_celular||"" },
        venta:{ concepto:citaACobrar.servicio_nombre, monto_total:monto, base_gravable:monto, valor_iva:0, porcentaje_iva:0, metodo_pago:cobrarMetodo },
        profesional_id:citaACobrar.profesional_id||"",
        profesional_nombre:citaACobrar.profesional_nombre||"",
        desde_agenda:true, estado_dian:"No aplica", fecha_creacion:new Date()
      };
      const batch = writeBatch(db);
      const ref = doc(collection(db,`negocios/${usuario.uid}/facturas`));
      batch.set(ref, facturaData);
      batch.set(doc(db,`negocios/${usuario.uid}/metricas`,periodoActual()),{ total_ventas:increment(monto), cantidad_transacciones:increment(1), ultima_actualizacion:new Date() },{ merge:true });
      batch.set(doc(db,`negocios/${usuario.uid}/citas`,citaACobrar.id),{ estado:"cobrada" },{ merge:true });
      await batch.commit();
      setCitasDelDia(prev=>prev.map(c=>c.id===citaACobrar.id?{...c,estado:"cobrada"}:c));
      setCitaACobrar(null); setCobrarMonto(""); setCobrarMetodo("Efectivo");
      alert("Cobro registrado.");
    } catch(e){ console.error(e); alert("Error al registrar el cobro."); }
    finally { setCobrandoCita(false); }
  };

  // ── confirmar cita pública ────────────────────────────────────────────────
  const confirmarCitaPublica = async () => {
    if (!pubSlot||!pubNombre.trim()) return;
    const serv = pubServicios.find(s=>s.id===pubServicioId);
    const prof = pubProfesionales.find(p=>p.id===pubProfId);
    setPubReservando(true);
    try {
      await addDoc(collection(db,`negocios/${pubUid}/citas`),{
        fecha:pubFecha, hora_inicio:pubSlot.horaInicio, hora_fin:pubSlot.horaFin,
        servicio_id:pubServicioId||"", servicio_nombre:serv?.nombre||"Sin especificar", servicio_duracion:serv?.duracion||30,
        profesional_id:pubProfId||"", profesional_nombre:prof?.nombre||"Sin asignar",
        cliente_nombre:pubNombre.trim(), cliente_celular:pubCelular||"N/A",
        estado:"confirmada", origen:"online", fecha_creacion:new Date()
      });
      setPubConfirmada(true);
    } catch { alert("Error al confirmar. Intente nuevamente."); }
    finally { setPubReservando(false); }
  };

  // ── navegar fecha ─────────────────────────────────────────────────────────
  const moverFecha = (days) => {
    const d = new Date(fechaAgenda+"T12:00:00");
    d.setDate(d.getDate()+days);
    setFechaAgenda(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // TEMA Y ESTILOS
  // ══════════════════════════════════════════════════════════════════════════
  const T = {
    bg:       darkMode ? "#0f172a" : "#f8fafc",
    surface:  darkMode ? "#1e293b" : "#ffffff",
    surfaceAlt: darkMode ? "#0f172a" : "#f8fafc",
    border:   darkMode ? "#334155" : "#e2e8f0",
    borderSub:darkMode ? "#1e293b" : "#f1f5f9",
    text:     darkMode ? "#f1f5f9" : "#0f172a",
    textSub:  darkMode ? "#94a3b8" : "#64748b",
    textMid:  darkMode ? "#cbd5e1" : "#334155",
    textMuted:darkMode ? "#64748b" : "#475569",
    inputBg:  darkMode ? "#0f172a" : "#ffffff",
    inputBorder: darkMode ? "#475569" : "#cbd5e1",
    tagBg:    darkMode ? "#334155" : "#f1f5f9",
    tagColor: darkMode ? "#cbd5e1" : "#475569",
  };

  const S = {
    page:{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",backgroundColor:T.bg,fontFamily:"system-ui,sans-serif",padding:"16px",boxSizing:"border-box" },
    layout:{ display:"flex",flexDirection:"row",minHeight:"100vh",backgroundColor:T.bg,fontFamily:"system-ui,sans-serif" },
    sidebar:{ width:"220px",minWidth:"220px",flexShrink:0,backgroundColor:"#0f172a",color:"#fff",display:"flex",flexDirection:"column",padding:"20px 14px",boxSizing:"border-box",gap:"2px",
      ...(isMobile ? { position:"fixed",top:0,left:menuAbierto?0:"-240px",height:"100vh",zIndex:200,transition:"left 0.25s ease",overflowY:"auto" } : { position:"sticky",top:0,height:"100vh",overflowY:"auto" })
    },
    logo:{ fontSize:"20px",fontWeight:"800",marginBottom:"20px",paddingLeft:"10px",display:"flex",alignItems:"baseline",gap:"5px" },
    vTag:{ fontSize:"9px",color:"#475569",fontWeight:"400" },
    mCat:{ fontSize:"10px",fontWeight:"700",color:"#334155",textTransform:"uppercase",padding:"14px 10px 4px",letterSpacing:"0.5px" },
    mBtn:(a)=>({ width:"100%",padding:"10px 14px",borderRadius:"6px",border:"none",backgroundColor:a?"#1e293b":"transparent",color:a?"#fff":"#94a3b8",textAlign:"left",fontSize:"13px",fontWeight:"600",cursor:"pointer" }),
    logoutBtn:{ width:"100%",padding:"10px 14px",borderRadius:"6px",border:"1px solid #1e293b",backgroundColor:"transparent",color:"#94a3b8",fontSize:"12px",fontWeight:"500",cursor:"pointer",marginTop:"auto" },
    main:{ flex:1,minWidth:0,padding:isMobile?"68px 14px 24px":"24px 20px",boxSizing:"border-box",overflowX:"hidden" },
    card:{ backgroundColor:T.surface,borderRadius:"10px",border:`1px solid ${T.border}`,boxShadow:darkMode?"0 1px 3px rgba(0,0,0,0.3)":"0 1px 3px rgba(0,0,0,0.05)",padding:"20px",boxSizing:"border-box" },
    h1:{ fontSize:"20px",fontWeight:"700",color:T.text,margin:"0 0 4px 0" },
    sub:{ fontSize:"13px",color:T.textSub,margin:"0 0 20px 0" },
    field:{ display:"flex",flexDirection:"column",marginBottom:"14px" },
    label:{ fontSize:"12px",fontWeight:"600",color:T.textMid,marginBottom:"5px" },
    input:{ width:"100%",padding:"9px 12px",fontSize:"13px",borderRadius:"6px",border:`1px solid ${T.inputBorder}`,boxSizing:"border-box",backgroundColor:T.inputBg,color:T.text },
    row:{ display:"flex",flexWrap:"wrap",gap:"14px" },
    secLabel:{ fontSize:"11px",fontWeight:"700",color:T.textMuted,textTransform:"uppercase",margin:"20px 0 10px",paddingBottom:"5px",borderBottom:`1px solid ${T.borderSub}` },
    btnPrimary:(color="#0f172a")=>({ width:"100%",padding:"11px",fontSize:"13px",fontWeight:"600",color:"#fff",border:"none",borderRadius:"6px",cursor:"pointer",backgroundColor:color,marginTop:"8px" }),
    btnSecondary:{ padding:"8px 16px",fontSize:"12px",fontWeight:"600",border:`1px solid ${T.border}`,borderRadius:"6px",cursor:"pointer",backgroundColor:T.surface,color:T.textMuted },
    kpiGrid:{ display:"flex",flexWrap:"wrap",gap:"14px",marginBottom:"20px" },
    kpiCard:{ flex:"1 1 180px",backgroundColor:T.surface,border:`1px solid ${T.border}`,borderRadius:"10px",padding:"18px" },
    kpiLabel:{ fontSize:"11px",fontWeight:"600",color:T.textSub,textTransform:"uppercase",margin:0 },
    kpiVal:{ fontSize:"22px",fontWeight:"800",color:T.text,margin:"6px 0 0 0" },
    table:{ width:"100%",borderCollapse:"collapse",fontSize:"13px" },
    th:{ textAlign:"left",padding:"11px 12px",backgroundColor:T.surfaceAlt,color:T.textMuted,fontWeight:"600",borderBottom:`1px solid ${T.border}` },
    td:{ padding:"13px 12px",borderBottom:`1px solid ${T.borderSub}`,color:T.textMid,verticalAlign:"middle" },
    badge:(bg,color)=>({ fontSize:"11px",fontWeight:"700",padding:"3px 8px",borderRadius:"20px",backgroundColor:bg,color:color }),
    tag:(bg,c)=>({ fontSize:"12px",fontWeight:"600",padding:"4px 10px",borderRadius:"20px",backgroundColor:bg||T.tagBg,color:c||T.tagColor }),
  };

  // ══════════════════════════════════════════════════════════════════════════
  // PANTALLA: BOOKING PÚBLICO
  // ══════════════════════════════════════════════════════════════════════════
  if (modoPublico) {
    const PUB = {
      wrap: { minHeight:"100vh", backgroundColor:T.bg, fontFamily:"system-ui,sans-serif" },
      hero: { backgroundColor:"#0f172a", padding:"28px 20px 24px", textAlign:"center" },
      logoCircle: (url) => url
        ? { width:"72px",height:"72px",borderRadius:"50%",backgroundImage:`url(${url})`,backgroundSize:"cover",backgroundPosition:"center",margin:"0 auto 12px",border:"3px solid rgba(255,255,255,0.2)" }
        : { width:"72px",height:"72px",borderRadius:"50%",backgroundColor:"#1e293b",border:"3px solid rgba(255,255,255,0.15)",margin:"0 auto 12px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"28px",fontWeight:"800",color:"#f59e0b" },
      negNombre: { fontSize:"22px",fontWeight:"800",color:"#fff",margin:"0 0 4px",letterSpacing:"-0.5px" },
      tagline: { fontSize:"13px",color:"#94a3b8",margin:0 },
      steps: { display:"flex",alignItems:"center",justifyContent:"center",gap:"0",padding:"0 20px",margin:"20px 0 0" },
      stepDot: (done,active) => ({ width:"28px",height:"28px",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"12px",fontWeight:"700",flexShrink:0,backgroundColor:done?"#f59e0b":active?"#fff":"rgba(255,255,255,0.15)",color:done?"#0f172a":active?"#0f172a":"rgba(255,255,255,0.4)" }),
      stepLine: (done) => ({ flex:1,height:"2px",backgroundColor:done?"#f59e0b":"rgba(255,255,255,0.15)" }),
      card: { backgroundColor:T.surface,margin:"16px",borderRadius:"16px",padding:"20px",boxShadow:darkMode?"0 4px 24px rgba(0,0,0,0.4)":"0 4px 24px rgba(0,0,0,0.08)" },
      servBtn: (sel) => ({ width:"100%",padding:"14px 16px",borderRadius:"10px",border:`2px solid ${sel?"#f59e0b":T.border}`,backgroundColor:sel?darkMode?"#422006":"#fffbeb":T.surface,cursor:"pointer",textAlign:"left",marginBottom:"8px",transition:"all 0.15s" }),
      profBtn: (sel) => ({ width:"100%",padding:"12px 14px",borderRadius:"10px",border:`2px solid ${sel?"#f59e0b":T.border}`,backgroundColor:sel?darkMode?"#422006":"#fffbeb":T.surface,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:"12px",marginBottom:"8px" }),
      profAvatar: { width:"40px",height:"40px",borderRadius:"50%",backgroundColor:"#0f172a",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:"700",fontSize:"16px",flexShrink:0 },
      slotBtn: (sel,ocu) => ({ padding:"11px 6px",borderRadius:"8px",border:`2px solid ${ocu?T.border:sel?"#f59e0b":darkMode?"#14532d":"#d1fae5"}`,backgroundColor:ocu?T.surfaceAlt:sel?darkMode?"#422006":"#fffbeb":darkMode?"#052e16":"#f0fdf4",color:ocu?T.textMuted:sel?"#f59e0b":darkMode?"#4ade80":"#065f46",fontWeight:"700",fontSize:"13px",cursor:ocu?"not-allowed":"pointer",textAlign:"center" }),
      btnPrimary: { width:"100%",padding:"14px",fontSize:"15px",fontWeight:"700",color:"#fff",border:"none",borderRadius:"10px",cursor:"pointer",backgroundColor:"#f59e0b",marginTop:"6px",letterSpacing:"-0.2px" },
      btnBack: { padding:"8px 14px",fontSize:"12px",fontWeight:"600",border:`1px solid ${T.border}`,borderRadius:"8px",cursor:"pointer",backgroundColor:"transparent",color:T.textSub,marginBottom:"16px" },
      input: { width:"100%",padding:"12px 14px",fontSize:"14px",borderRadius:"10px",border:`1px solid ${T.inputBorder}`,boxSizing:"border-box",marginTop:"5px",backgroundColor:T.inputBg,color:T.text },
      label: { fontSize:"13px",fontWeight:"600",color:T.textMid,display:"block",marginBottom:"12px" },
      footer: { textAlign:"center",padding:"20px",fontSize:"11px",color:T.textSub }
    };

    const inicial = (pubNegocioNombre||"?")[0].toUpperCase();

    if (pubCargando) return (
      <div style={{...PUB.wrap,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:"12px"}}>
        <div style={{width:"40px",height:"40px",borderRadius:"50%",backgroundColor:"#0f172a",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{width:"20px",height:"20px",border:"3px solid rgba(255,255,255,0.3)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
        </div>
        <p style={{color:"#64748b",fontSize:"13px",margin:0}}>Cargando disponibilidad...</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );

    if (pubReglasError && pubServicios.length === 0) return (
      <div style={{...PUB.wrap,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{maxWidth:"360px",textAlign:"center",padding:"24px"}}>
          <div style={{fontSize:"48px",marginBottom:"12px"}}>🔒</div>
          <h2 style={{fontWeight:"800",color:"#0f172a",margin:"0 0 8px"}}>Agenda no disponible</h2>
          <p style={{color:"#64748b",fontSize:"14px",lineHeight:"1.6"}}>El dueño del negocio debe activar las reservas públicas desde su consola.</p>
        </div>
      </div>
    );

    if (pubConfirmada) {
      const servConf = pubServicios.find(s=>s.id===pubServicioId);
      const profConf = pubProfesionales.find(p=>p.id===pubProfId);
      return (
        <div style={PUB.wrap}>
          <div style={PUB.hero}>
            {pubLogoUrl
              ? <div style={PUB.logoCircle(pubLogoUrl)}/>
              : <div style={PUB.logoCircle("")}>{inicial}</div>}
            <h1 style={PUB.negNombre}>{pubNegocioNombre}</h1>
          </div>
          <div style={{...PUB.card,margin:"24px 16px",textAlign:"center"}}>
            <div style={{width:"64px",height:"64px",borderRadius:"50%",backgroundColor:"#f0fdf4",border:"3px solid #86efac",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"28px",margin:"0 auto 16px"}}>✓</div>
            <h2 style={{fontWeight:"800",color:"#0f172a",fontSize:"20px",margin:"0 0 6px"}}>¡Cita Confirmada!</h2>
            <p style={{color:"#64748b",fontSize:"14px",margin:"0 0 20px"}}>Te esperamos. ¡Hasta pronto!</p>
            <div style={{backgroundColor:"#f8fafc",borderRadius:"10px",padding:"14px",textAlign:"left"}}>
              {servConf && <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f1f5f9",fontSize:"14px"}}><span style={{color:"#64748b"}}>Servicio</span><strong>{servConf.nombre}</strong></div>}
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f1f5f9",fontSize:"14px"}}><span style={{color:"#64748b"}}>Fecha</span><strong style={{textTransform:"capitalize"}}>{fechaLarga(pubFecha)}</strong></div>
              {pubSlot && <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f1f5f9",fontSize:"14px"}}><span style={{color:"#64748b"}}>Hora</span><strong>{hora12(pubSlot.horaInicio)} – {hora12(pubSlot.horaFin)}</strong></div>}
              {profConf && <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",fontSize:"14px"}}><span style={{color:"#64748b"}}>Profesional</span><strong>{profConf.nombre}</strong></div>}
            </div>
          </div>
          <div style={PUB.footer}>Reserva gestionada con Soldi</div>
        </div>
      );
    }

    const pubServSelec = pubServicios.find(s=>s.id===pubServicioId);
    const ahora = new Date();
    const horaActual = `${String(ahora.getHours()).padStart(2,"0")}:${String(ahora.getMinutes()).padStart(2,"0")}`;
    const pubSlotsDisp = pubServSelec
      ? generarSlots(pubConfig, pubCitasDia, pubServSelec.duracion).map(sl => ({
          ...sl,
          ocupado: sl.ocupado || (pubFecha === hoy() && sl.horaInicio < horaActual)
        }))
      : [];
    const diaActivoPub = (pubConfig.dias_activos||[]).includes(nombreDia(pubFecha));
    const totalSteps = pubProfesionales.length > 0 ? 4 : 3;
    const stepActual = pubProfesionales.length > 0 ? pubStep : pubStep === 1 ? 1 : pubStep - 1;

    return (
      <div style={PUB.wrap}>
        {/* ── HERO ── */}
        <div style={PUB.hero}>
          {pubLogoUrl
            ? <div style={PUB.logoCircle(pubLogoUrl)}/>
            : <div style={PUB.logoCircle("")}>{inicial}</div>}
          <h1 style={PUB.negNombre}>{pubNegocioNombre || "Reserva tu cita"}</h1>
          {pubTagline && <p style={PUB.tagline}>{pubTagline}</p>}

          {/* barra de progreso */}
          <div style={PUB.steps}>
            {Array.from({length:totalSteps}).map((_,i)=>{
              const n=i+1;
              const done=stepActual>n, active=stepActual===n;
              return (
                <div key={i} style={{display:"flex",alignItems:"center",flex:i<totalSteps-1?1:"none"}}>
                  <div style={PUB.stepDot(done,active)}>{done?"✓":n}</div>
                  {i<totalSteps-1 && <div style={PUB.stepLine(done)}/>}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── CONTENIDO ── */}
        <div style={PUB.card}>

          {/* PASO 1: servicio */}
          {pubStep===1 && (
            <div>
              <h3 style={{fontSize:"17px",fontWeight:"800",color:T.text,margin:"0 0 4px"}}>¿Qué servicio deseas?</h3>
              <p style={{fontSize:"13px",color:T.textSub,margin:"0 0 16px"}}>Elige el servicio que quieres reservar</p>
              {pubServicios.length===0 && <p style={{color:"#64748b",fontSize:"14px",textAlign:"center",padding:"20px"}}>Este negocio no tiene servicios disponibles aún.</p>}
              {pubServicios.map(s=>(
                <button key={s.id} onClick={()=>{ setPubServicioId(s.id); setPubStep(pubProfesionales.length>0?2:3); }} style={PUB.servBtn(pubServicioId===s.id)}>
                  <div style={{fontWeight:"700",color:T.text,fontSize:"15px"}}>{s.nombre}</div>
                  <div style={{fontSize:"13px",color:T.textSub,marginTop:"3px",display:"flex",gap:"12px"}}>
                    <span>⏱ {s.duracion} min</span>
                    <span>💰 ${Number(s.precio).toLocaleString("es-CO")}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* PASO 2: profesional */}
          {pubStep===2 && (
            <div>
              <button onClick={()=>setPubStep(1)} style={PUB.btnBack}>← Atrás</button>
              <h3 style={{fontSize:"17px",fontWeight:"800",color:T.text,margin:"0 0 4px"}}>¿Con quién te atiendes?</h3>
              <p style={{fontSize:"13px",color:T.textSub,margin:"0 0 16px"}}>Selecciona tu profesional de confianza</p>
              <button onClick={()=>{ setPubProfId(""); setPubStep(3); }} style={PUB.profBtn(pubProfId===""&&pubServicioId)}>
                <div style={{...PUB.profAvatar,backgroundColor:"#475569",fontSize:"20px"}}>✦</div>
                <div>
                  <div style={{fontWeight:"700",color:T.text,fontSize:"14px"}}>Cualquier disponible</div>
                  <div style={{fontSize:"12px",color:T.textSub}}>El primero con horario libre</div>
                </div>
              </button>
              {pubProfesionales.map(p=>(
                <button key={p.id} onClick={()=>{ setPubProfId(p.id); setPubStep(3); }} style={PUB.profBtn(pubProfId===p.id)}>
                  <div style={PUB.profAvatar}>{p.nombre[0].toUpperCase()}</div>
                  <div>
                    <div style={{fontWeight:"700",color:T.text,fontSize:"14px"}}>{p.nombre}</div>
                    {p.especialidad && <div style={{fontSize:"12px",color:T.textSub}}>{p.especialidad}</div>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* PASO 3: fecha y hora */}
          {pubStep===3 && (
            <div>
              <button onClick={()=>setPubStep(pubProfesionales.length>0?2:1)} style={PUB.btnBack}>← Atrás</button>
              <h3 style={{fontSize:"17px",fontWeight:"800",color:T.text,margin:"0 0 4px"}}>¿Cuándo te venimos bien?</h3>
              <p style={{fontSize:"13px",color:T.textSub,margin:"0 0 16px"}}>Elige la fecha y el horario que prefieras</p>
              <label style={PUB.label}>
                Fecha
                <input type="date" value={pubFecha} min={hoy()} onChange={e=>{setPubFecha(e.target.value);setPubSlot(null);}} style={PUB.input}/>
              </label>
              {!diaActivoPub ? (
                <div style={{padding:"14px",backgroundColor:"#fff7ed",borderRadius:"10px",color:"#92400e",fontSize:"13px",fontWeight:"600",border:"1px solid #fed7aa"}}>
                  Cerrado los {nombreDia(pubFecha)} — elige otra fecha
                </div>
              ) : pubSlotsDisp.filter(s=>!s.ocupado).length===0 ? (
                <div style={{padding:"14px",backgroundColor:"#fff7ed",borderRadius:"10px",color:"#92400e",fontSize:"13px",fontWeight:"600",border:"1px solid #fed7aa"}}>
                  Sin turnos disponibles este día — prueba otra fecha
                </div>
              ) : (
                <div>
                  <p style={{fontSize:"12px",color:"#64748b",margin:"0 0 10px",fontWeight:"600"}}>TURNOS DISPONIBLES</p>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(100px,1fr))",gap:"8px"}}>
                    {pubSlotsDisp.map((sl,i)=>(
                      <button key={i} disabled={sl.ocupado} onClick={()=>{ if(!sl.ocupado){setPubSlot(sl);setPubStep(4);} }} style={PUB.slotBtn(pubSlot?.horaInicio===sl.horaInicio,sl.ocupado)}>
                        {hora12(sl.horaInicio)}
                        {sl.ocupado && <div style={{fontSize:"9px",marginTop:"2px",opacity:0.6}}>Ocupado</div>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PASO 4: datos del cliente */}
          {pubStep===4 && (
            <div>
              <button onClick={()=>setPubStep(3)} style={PUB.btnBack}>← Atrás</button>
              <h3 style={{fontSize:"17px",fontWeight:"800",color:T.text,margin:"0 0 16px"}}>Casi listo — ¿tus datos?</h3>
              {/* resumen */}
              <div style={{backgroundColor:"#fffbeb",border:"1px solid #fde68a",borderRadius:"10px",padding:"12px",marginBottom:"16px",fontSize:"13px"}}>
                <div style={{fontWeight:"700",color:"#92400e",marginBottom:"4px"}}>Tu cita:</div>
                <div style={{color:"#78350f"}}>
                  {pubServSelec?.nombre} · {hora12(pubSlot?.horaInicio||"")} – {hora12(pubSlot?.horaFin||"")}
                </div>
                <div style={{color:"#a16207",textTransform:"capitalize"}}>{fechaLarga(pubFecha)}</div>
                {pubProfId && pubProfesionales.find(p=>p.id===pubProfId) &&
                  <div style={{color:"#a16207"}}>Con {pubProfesionales.find(p=>p.id===pubProfId).nombre}</div>}
              </div>
              <label style={PUB.label}>
                Tu nombre *
                <input type="text" placeholder="¿Cómo te llamas?" value={pubNombre} onChange={e=>setPubNombre(e.target.value)} style={PUB.input}/>
              </label>
              <label style={PUB.label}>
                Celular (opcional)
                <input type="tel" placeholder="3001234567" value={pubCelular} onChange={e=>setPubCelular(e.target.value)} style={PUB.input}/>
              </label>
              <button onClick={confirmarCitaPublica} disabled={pubReservando||!pubNombre.trim()} style={{...PUB.btnPrimary,opacity:pubNombre.trim()?1:0.45,marginTop:"8px"}}>
                {pubReservando ? "Confirmando..." : "Confirmar mi cita"}
              </button>
            </div>
          )}
        </div>

        <div style={PUB.footer}>Reserva gestionada con <strong>Soldi</strong></div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PANTALLAS DE ESTADO (cargando / login / suspendido)
  // ══════════════════════════════════════════════════════════════════════════
  if (cargandoAuth) return <div style={S.page}><p style={{color:T.textSub}}>Cargando...</p></div>;

  // Admin check va primero — nunca debe ver la pantalla de suspensión
  if (esAdmin && usuario) {
    const totalActivos = negociosList.filter(n => n.activo !== false).length;
    const porTipo = negociosList.reduce((acc,n) => { const t = n.tipo_negocio||"barberia"; acc[t]=(acc[t]||0)+1; return acc; }, {});
    return (
      <div style={S.layout}>
        <div style={S.sidebar}>
          <div style={S.logo}>Soldi <span style={S.vTag}>Admin</span></div>
          <p style={S.mCat}>Sistema</p>
          <div style={{padding:"10px 14px",fontSize:"12px",color:"#94a3b8",lineHeight:"1.8"}}>
            <div>Total: <strong style={{color:"#fff"}}>{negociosList.length}</strong></div>
            <div>Activos: <strong style={{color:"#22c55e"}}>{totalActivos}</strong></div>
            <div>Suspendidos: <strong style={{color:"#ef4444"}}>{negociosList.length - totalActivos}</strong></div>
          </div>
          <button onClick={refrescarNegocios} disabled={cargandoNegocios} style={{...S.btnSecondary,width:"calc(100% - 28px)",margin:"4px 14px",fontSize:"11px"}}>{cargandoNegocios?"Cargando...":"↻ Refrescar"}</button>
          <button onClick={cerrarSesion} style={S.logoutBtn}>Cerrar sesión</button>
        </div>
        <div style={S.main}>
          <h1 style={S.h1}>Panel de Administración</h1>
          <p style={S.sub}>Gestión de negocios registrados en Soldi.</p>
          <div style={S.kpiGrid}>
            <div style={S.kpiCard}><p style={S.kpiLabel}>Total Negocios</p><h3 style={S.kpiVal}>{negociosList.length}</h3></div>
            <div style={S.kpiCard}><p style={S.kpiLabel}>Activos</p><h3 style={{...S.kpiVal,color:"#16a34a"}}>{totalActivos}</h3></div>
            <div style={S.kpiCard}><p style={S.kpiLabel}>Suspendidos</p><h3 style={{...S.kpiVal,color:"#dc2626"}}>{negociosList.length - totalActivos}</h3></div>
            {Object.entries(porTipo).map(([t,c]) => (
              <div key={t} style={S.kpiCard}><p style={S.kpiLabel}>{t.charAt(0).toUpperCase()+t.slice(1)}</p><h3 style={S.kpiVal}>{c}</h3></div>
            ))}
          </div>
          <div style={S.card}>
            {negociosList.length === 0 && !cargandoNegocios && <p style={{color:"#64748b",fontSize:"13px",textAlign:"center",padding:"24px"}}>No hay negocios registrados.</p>}
            {cargandoNegocios && <p style={{color:"#64748b",fontSize:"13px",textAlign:"center",padding:"24px"}}>Cargando...</p>}
            {negociosList.length > 0 && (
              <div style={{overflowX:"auto"}}>
                <table style={S.table}>
                  <thead><tr><th style={S.th}>Negocio</th><th style={S.th}>ID</th><th style={S.th}>Tipo</th><th style={{...S.th,textAlign:"center"}}>Estado</th></tr></thead>
                  <tbody>
                    {negociosList.map(n => (
                      <tr key={n.id}>
                        <td style={{...S.td,fontWeight:"700"}}>{n.nombre_comercial || "Sin nombre"}</td>
                        <td style={{...S.td,fontSize:"11px",color:"#94a3b8",fontFamily:"monospace"}}>{n.id.substring(0,12)}...</td>
                        <td style={S.td}>
                          <select value={n.tipo_negocio || "barberia"} onChange={e => cambiarTipoAdmin(n.id, e.target.value)} style={{...S.input,padding:"5px 8px",fontSize:"12px",width:"auto"}}>
                            <option value="barberia">Barbería</option>
                            <option value="restaurante">Restaurante</option>
                            <option value="tienda">Tienda</option>
                          </select>
                        </td>
                        <td style={{...S.td,textAlign:"center"}}>
                          <button onClick={() => toggleActivoAdmin(n.id, n.activo !== false)} style={{padding:"5px 12px",fontSize:"11px",fontWeight:"700",border:"none",borderRadius:"20px",cursor:"pointer",backgroundColor:n.activo!==false?"#dcfce7":"#fee2e2",color:n.activo!==false?"#166534":"#dc2626"}}>
                            {n.activo !== false ? "Activo" : "Suspendido"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!usuario) return (
    <div style={S.page}>
      <div style={{width:"100%",maxWidth:"420px"}}>
        <div style={S.card}>
          <h2 style={S.h1}>{modoRegistro?"Crear Cuenta":"Iniciar Sesión"}</h2>
          <p style={S.sub}>{modoRegistro?"Registre su establecimiento en Soldi.":"Ingrese a su consola operativa."}</p>
          <form onSubmit={ejecutarAuth}>
            {modoRegistro&&<div style={S.field}><label style={S.label}>Nombre del Negocio</label><input type="text" placeholder="Ej: Barbería El Estilo" value={nombreNegocio} onChange={e=>setNombreNegocio(e.target.value)} style={S.input} required/></div>}
            <div style={S.field}><label style={S.label}>Correo Electrónico</label><input type="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} style={S.input} required/></div>
            <div style={S.field}><label style={S.label}>Contraseña</label><input type="password" value={authPassword} onChange={e=>setAuthPassword(e.target.value)} style={S.input} required/></div>
            <button type="submit" disabled={procesandoAccion} style={S.btnPrimary()}>{procesandoAccion?"...":modoRegistro?"Registrarme":"Ingresar"}</button>
          </form>
          <p style={{textAlign:"center",fontSize:"12px",color:"#64748b",marginTop:"16px",cursor:"pointer",textDecoration:"underline"}} onClick={()=>setModoRegistro(!modoRegistro)}>
            {modoRegistro?"¿Ya tienes cuenta? Ingresa aquí":"¿Nuevo negocio? Regístralo aquí"}
          </p>
        </div>
      </div>
    </div>
  );

  if (!negocioActivo) return (
    <div style={S.page}>
      <div style={{...S.card,maxWidth:"440px",textAlign:"center",border:"1px solid #ef4444"}}>
        <h2 style={{...S.h1,color:"#b91c1c"}}>Acceso Suspendido</h2>
        <p style={{...S.sub,marginTop:"8px"}}>Su suscripción tiene un pendiente de pago. Comuníquese con el administrador.</p>
        <button onClick={cerrarSesion} style={S.btnPrimary()}>Cambiar de Cuenta</button>
      </div>
    </div>
  );



  // ══════════════════════════════════════════════════════════════════════════
  // VARIABLES DERIVADAS (agenda)
  // ══════════════════════════════════════════════════════════════════════════
  const diaActivo = (configAgenda.dias_activos||[]).includes(nombreDia(fechaAgenda));
  const ncServ = servicios.find(s=>s.id===ncServicioId);
  const slotsNuevaCita = ncServ && diaActivo ? generarSlots(configAgenda, citasDelDia, ncServ.duracion) : [];
  const citasConfirmadas = citasDelDia
    .filter(c=>c.estado!=="cancelada")
    .filter(c=>filtroProfAgenda==="todos"||c.profesional_id===filtroProfAgenda)
    .sort((a,b)=>a.hora_inicio.localeCompare(b.hora_inicio));
  const urlPublica = `${window.location.origin}${window.location.pathname}?b=${usuario.uid}`;
  const ir = (seccion, extra) => { setSeccionActiva(seccion); if (extra) extra(); setMenuAbierto(false); };

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER PRINCIPAL
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div style={S.layout}>
      {/* ── BARRA MÓVIL ────────────────────────────────────────────── */}
      {isMobile && (
        <div style={{position:"fixed",top:0,left:0,right:0,height:"52px",backgroundColor:"#0f172a",display:"flex",alignItems:"center",padding:"0 14px",zIndex:201,gap:"12px"}}>
          <button onClick={()=>setMenuAbierto(!menuAbierto)} style={{background:"none",border:"none",color:"#fff",fontSize:"22px",cursor:"pointer",padding:"4px",lineHeight:1}}>☰</button>
          <span style={{fontWeight:"800",fontSize:"18px",color:"#fff",flex:1}}>Soldi</span>
          <button onClick={cerrarSesion} style={{background:"none",border:"1px solid #334155",borderRadius:"6px",color:"#94a3b8",fontSize:"11px",fontWeight:"600",padding:"5px 10px",cursor:"pointer"}}>Salir</button>
        </div>
      )}

      {/* ── OVERLAY ────────────────────────────────────────────────── */}
      {isMobile && menuAbierto && (
        <div onClick={()=>setMenuAbierto(false)} style={{position:"fixed",inset:0,backgroundColor:"rgba(0,0,0,0.55)",zIndex:199}}/>
      )}

      <style>{`
        :root {
          --dm-text: ${T.text};
          --dm-sub: ${T.textSub};
          --dm-mid: ${T.textMid};
          --dm-muted: ${T.textMuted};
          --dm-bg: ${T.bg};
          --dm-surface: ${T.surface};
          --dm-border: ${T.border};
        }
        body { background-color: ${T.bg}; color: ${T.text}; }
        input, select, textarea {
          background-color: ${T.inputBg} !important;
          color: ${T.text} !important;
          border-color: ${T.inputBorder} !important;
        }
        ${darkMode ? `
          [data-dmtext] { color: ${T.text} !important; }
          [data-dmsub] { color: ${T.textSub} !important; }
        ` : ""}
      `}</style>

      {/* ── SIDEBAR ─────────────────────────────────────────────────────── */}
      <div style={S.sidebar}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"20px",paddingLeft:"10px"}}>
          <div style={S.logo}>Soldi <span style={S.vTag}>1.2</span></div>
          {isMobile && <button onClick={()=>setMenuAbierto(false)} style={{background:"none",border:"none",color:"#94a3b8",fontSize:"20px",cursor:"pointer",lineHeight:1,padding:"2px 6px"}}>✕</button>}
        </div>

        <p style={S.mCat}>Ventas</p>
        <button style={S.mBtn(seccionActiva==="dashboard")} onClick={()=>ir("dashboard")}>Dashboard</button>
        <button style={S.mBtn(seccionActiva==="registrar")} onClick={()=>ir("registrar")}>Registrar Venta</button>
        <button style={S.mBtn(seccionActiva==="historial")} onClick={()=>ir("historial")}>Historial de Ventas</button>

        {tipoNegocio !== "restaurante" && tipoNegocio !== "tienda" && <>
          <p style={S.mCat}>Agenda</p>
          <button style={S.mBtn(seccionActiva==="agenda")} onClick={()=>ir("agenda",()=>setTabAgenda(0))}>Agenda de Citas</button>
          <button style={S.mBtn(seccionActiva==="profesionales")} onClick={()=>ir("profesionales")}>Profesionales</button>
        </>}

        {tipoNegocio === "restaurante" && <>
          <p style={S.mCat}>Restaurante</p>
          <button style={S.mBtn(seccionActiva==="valeras")} onClick={()=>ir("valeras")}>Sistema de Valeras</button>
        </>}

        {tipoNegocio === "tienda" && <>
          <p style={S.mCat}>Tienda</p>
          <button style={S.mBtn(seccionActiva==="fiar")} onClick={()=>ir("fiar")}>Sistema de Fiar</button>
        </>}

        <p style={S.mCat}>Catálogo</p>
        <button style={S.mBtn(seccionActiva==="servicios")} onClick={()=>ir("servicios")}>{tipoNegocio==="barberia"?"Servicios":"Productos"}</button>

        <p style={S.mCat}>Ajustes</p>
        <button style={S.mBtn(seccionActiva==="perfil")} onClick={()=>ir("perfil")}>Perfil del Negocio</button>
        {tipoNegocio !== "restaurante" && tipoNegocio !== "tienda" && <button style={S.mBtn(seccionActiva==="configuracion")} onClick={()=>ir("configuracion")}>Horario de Atención</button>}

        {!isMobile && <button onClick={cerrarSesion} style={S.logoutBtn}>Cerrar sesión</button>}
      </div>

      {/* ── CONTENIDO ───────────────────────────────────────────────────── */}
      <div style={S.main}>

        {/* ─── DASHBOARD ─────────────────────────────────────────────────── */}
        {seccionActiva==="dashboard" && (() => {
          // ── analytics ────────────────────────────────────────────────────
          const fmtCOP = n => `$${Number(n).toLocaleString("es-CO")}`;
          const total  = facturasDash.reduce((s,f)=>s+Number(f.venta?.monto_total||0),0);
          const count  = facturasDash.length;
          const avg    = count>0 ? total/count : 0;

          // canales de pago
          const coloresMetodo = { Efectivo:"#16a34a", Nequi:"#7c3aed", Daviplata:"#0ea5e9", Bancolombia:"#d97706", Tarjeta:"#dc2626" };
          const porMetodo = {};
          facturasDash.forEach(f=>{ const m=f.venta?.metodo_pago||"Otro"; porMetodo[m]=(porMetodo[m]||0)+Number(f.venta?.monto_total||0); });
          const metodoList = Object.entries(porMetodo).sort((a,b)=>b[1]-a[1]);
          const maxMetodo  = metodoList[0]?.[1]||1;

          // top productos
          const porProd = {};
          facturasDash.forEach(f=>{ const c=f.venta?.concepto||"Sin concepto"; if(!porProd[c]) porProd[c]={n:0,t:0}; porProd[c].n++; porProd[c].t+=Number(f.venta?.monto_total||0); });
          const prodList = Object.entries(porProd).sort((a,b)=>b[1].t-a[1].t).slice(0,7);
          const maxProd  = prodList[0]?.[1].t||1;

          // top clientes (excluye anónimos)
          const porCli = {};
          facturasDash.forEach(f=>{ const n=(f.cliente?.nombre||"").trim(); if(!n||n==="Cuantías Menores"||n==="Sin nombre") return; if(!porCli[n]) porCli[n]={n:0,t:0}; porCli[n].n++; porCli[n].t+=Number(f.venta?.monto_total||0); });
          const cliList = Object.entries(porCli).sort((a,b)=>b[1].t-a[1].t).slice(0,6);
          const maxCli  = cliList[0]?.[1].t||1;

          // por profesional (solo facturas desde agenda)
          const porProf = {};
          facturasDash.forEach(f=>{ const n=(f.profesional_nombre||"").trim(); if(!n||n==="Sin asignar") return; if(!porProf[n]) porProf[n]={n:0,t:0}; porProf[n].n++; porProf[n].t+=Number(f.venta?.monto_total||0); });
          const profList = Object.entries(porProf).sort((a,b)=>b[1].t-a[1].t);
          const maxProf  = profList[0]?.[1].t||1;

          // por día de semana
          const DIAS=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
          const porDia=Array(7).fill(0);
          facturasDash.forEach(f=>{ const ts=f.fecha_creacion?.seconds?new Date(f.fecha_creacion.seconds*1000):null; if(ts) porDia[ts.getDay()]++; });
          const maxDia=Math.max(...porDia,1);
          const mejorDia=porDia.some(v=>v>0)?DIAS[porDia.indexOf(Math.max(...porDia))]:"—";

          // por hora
          const porHora=Array(24).fill(0);
          facturasDash.forEach(f=>{ const ts=f.fecha_creacion?.seconds?new Date(f.fecha_creacion.seconds*1000):null; if(ts) porHora[ts.getHours()]++; });
          const horasActivas=porHora.map((v,h)=>({h,v})).filter(x=>x.v>0);
          const maxHora=Math.max(...porHora,1);
          const mejorHora=horasActivas.length>0?horasActivas.reduce((a,b)=>b.v>a.v?b:a):null;
          const fmtHora=h=>h===0?"12am":h<12?`${h}am`:h===12?"12pm":`${h-12}pm`;

          // meses disponibles para el selector (últimos 24 meses)
          const mesesOpc=[];
          const ahora=new Date();
          for(let i=0;i<24;i++){
            const d=new Date(ahora.getFullYear(),ahora.getMonth()-i,1);
            const v=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
            const l=d.toLocaleDateString("es-CO",{month:"long",year:"numeric"});
            mesesOpc.push({v,l});
          }

          const Barra=({pct,color="#2563eb",h=8})=>(
            <div style={{flex:1,height:`${h}px`,backgroundColor:T.border,borderRadius:"99px",overflow:"hidden"}}>
              <div style={{width:`${Math.max(pct,2)}%`,height:"100%",backgroundColor:color,borderRadius:"99px",transition:"width 0.5s ease"}}/>
            </div>
          );
          const SecTitle=({children})=>(
            <h3 style={{fontSize:"13px",fontWeight:"700",color:T.textSub,textTransform:"uppercase",letterSpacing:"0.06em",margin:"0 0 14px"}}>{children}</h3>
          );
          const Panel=({children,style})=>(
            <div style={{backgroundColor:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"20px",...style}}>{children}</div>
          );

          return (
            <div>
              {/* encabezado */}
              <div style={{marginBottom:"16px"}}>
                <h1 style={{...S.h1,marginBottom:"2px"}}>Datos de Ventas</h1>
                <p style={{...S.sub,margin:0}}>Resumen de facturación y comportamiento del negocio.</p>
              </div>

              {/* filtros de periodo */}
              <div style={{display:"flex",flexWrap:"wrap",gap:"10px",alignItems:"center",marginBottom:"20px"}}>
                <div style={{display:"flex",backgroundColor:T.border,borderRadius:"8px",padding:"3px",gap:"2px"}}>
                  {[["Día","dia"],["Semana","semana"],["Mes","mes"]].map(([l,v])=>(
                    <button key={v} onClick={()=>setDashPeriodo(v)} style={{padding:"6px 14px",borderRadius:"6px",border:"none",fontWeight:"700",fontSize:"12px",cursor:"pointer",backgroundColor:dashPeriodo===v?"#0f172a":"transparent",color:dashPeriodo===v?"#fff":T.textSub}}>
                      {l}
                    </button>
                  ))}
                </div>
                {dashPeriodo==="mes" && (
                  <select value={dashMes} onChange={e=>setDashMes(e.target.value)} style={{...S.input,width:"auto",fontWeight:"600",fontSize:"13px",padding:"7px 12px"}}>
                    {mesesOpc.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                )}
                {(dashPeriodo==="dia"||dashPeriodo==="semana") && (
                  <input type="date" value={dashFecha} onChange={e=>setDashFecha(e.target.value)} style={{...S.input,width:"auto",fontWeight:"600",fontSize:"13px",padding:"7px 12px"}}/>
                )}
                {cargandoDash && <span style={{fontSize:"12px",color:T.textSub}}>Cargando...</span>}
              </div>

              {count===0 && !cargandoDash && (
                <Panel><p style={{color:T.textSub,fontSize:"13px",textAlign:"center",padding:"20px 0",margin:0}}>No hay ventas registradas en este periodo.</p></Panel>
              )}

              {count>0 && <>
                {/* ── KPIs ── */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"12px",marginBottom:"20px"}}>
                  {[
                    {l:"Total facturado",v:fmtCOP(total),c:"#2563eb"},
                    {l:"Transacciones",v:count,c:"#0891b2"},
                    {l:"Ticket promedio",v:fmtCOP(Math.round(avg)),c:"#7c3aed"},
                    {l:"Día más activo",v:mejorDia,c:"#16a34a"},
                    ...(mejorHora?[{l:"Hora pico",v:fmtHora(mejorHora.h),c:"#d97706"}]:[]),
                  ].map(k=>(
                    <div key={k.l} style={{backgroundColor:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"16px"}}>
                      <p style={{fontSize:"11px",fontWeight:"600",color:T.textSub,margin:"0 0 6px",textTransform:"uppercase",letterSpacing:"0.05em"}}>{k.l}</p>
                      <p style={{fontSize:"22px",fontWeight:"800",color:k.c,margin:0}}>{k.v}</p>
                    </div>
                  ))}
                </div>

                {/* ── fila principal ── */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:"16px",marginBottom:"16px"}}>

                  {/* Canales de pago */}
                  <Panel>
                    <SecTitle>Canales de Pago</SecTitle>
                    {metodoList.map(([m,t])=>(
                      <div key={m} style={{marginBottom:"14px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:"5px"}}>
                          <span style={{fontSize:"13px",fontWeight:"600",color:T.text}}>{m}</span>
                          <div style={{textAlign:"right"}}>
                            <span style={{fontSize:"13px",fontWeight:"700",color:T.text}}>{fmtCOP(t)}</span>
                            <span style={{fontSize:"11px",color:T.textSub,marginLeft:"6px"}}>{Math.round(t/total*100)}%</span>
                          </div>
                        </div>
                        <Barra pct={t/maxMetodo*100} color={coloresMetodo[m]||"#64748b"} h={10}/>
                      </div>
                    ))}
                  </Panel>

                  {/* Top productos */}
                  <Panel>
                    <SecTitle>Top {tipoNegocio==="barberia"?"Servicios":"Productos"}</SecTitle>
                    {prodList.map(([c,d],i)=>(
                      <div key={c} style={{marginBottom:"12px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px",gap:"8px"}}>
                          <span style={{fontSize:"13px",fontWeight:"600",color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{i+1}. {c}</span>
                          <div style={{textAlign:"right",flexShrink:0}}>
                            <span style={{fontSize:"12px",fontWeight:"700",color:T.text}}>{fmtCOP(d.t)}</span>
                            <span style={{fontSize:"11px",color:T.textSub,marginLeft:"5px"}}>{d.n}x</span>
                          </div>
                        </div>
                        <Barra pct={d.t/maxProd*100} color="#2563eb" h={7}/>
                      </div>
                    ))}
                  </Panel>
                </div>

                {/* ── fila secundaria ── */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:"16px",marginBottom:"16px"}}>

                  {/* Top clientes */}
                  {cliList.length>0 && (
                    <Panel>
                      <SecTitle>Top Clientes</SecTitle>
                      {cliList.map(([n,d],i)=>(
                        <div key={n} style={{marginBottom:"12px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px",gap:"8px"}}>
                            <span style={{fontSize:"13px",fontWeight:"600",color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>
                              <span style={{display:"inline-block",width:"18px",height:"18px",backgroundColor:["#fbbf24","#94a3b8","#cd7c3f","#64748b","#64748b"][i]||T.border,borderRadius:"50%",textAlign:"center",lineHeight:"18px",fontSize:"10px",fontWeight:"800",color:"#fff",marginRight:"6px"}}>{i+1}</span>
                              {n}
                            </span>
                            <div style={{textAlign:"right",flexShrink:0}}>
                              <span style={{fontSize:"12px",fontWeight:"700",color:T.text}}>{fmtCOP(d.t)}</span>
                              <span style={{fontSize:"11px",color:T.textSub,marginLeft:"5px"}}>{d.n} visita{d.n!==1?"s":""}</span>
                            </div>
                          </div>
                          <Barra pct={d.t/maxCli*100} color="#7c3aed" h={7}/>
                        </div>
                      ))}
                    </Panel>
                  )}

                  {/* Por profesional */}
                  {profList.length>0 && (
                    <Panel>
                      <SecTitle>Por Barbero / Profesional</SecTitle>
                      {profList.map(([n,d])=>(
                        <div key={n} style={{marginBottom:"12px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px",gap:"8px"}}>
                            <span style={{fontSize:"13px",fontWeight:"600",color:T.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{n}</span>
                            <div style={{textAlign:"right",flexShrink:0}}>
                              <span style={{fontSize:"12px",fontWeight:"700",color:T.text}}>{fmtCOP(d.t)}</span>
                              <span style={{fontSize:"11px",color:T.textSub,marginLeft:"5px"}}>{d.n} cobro{d.n!==1?"s":""}</span>
                            </div>
                          </div>
                          <Barra pct={d.t/maxProf*100} color="#0891b2" h={8}/>
                        </div>
                      ))}
                    </Panel>
                  )}

                  {/* Ventas por día de semana */}
                  <Panel>
                    <SecTitle>Ventas por Día</SecTitle>
                    {DIAS.map((d,i)=>(
                      <div key={d} style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"8px"}}>
                        <span style={{fontSize:"12px",fontWeight:"600",color:porDia[i]>0?T.text:T.textSub,width:"28px",flexShrink:0}}>{d}</span>
                        <Barra pct={porDia[i]/maxDia*100} color={porDia[i]===Math.max(...porDia)?"#16a34a":"#0ea5e9"} h={8}/>
                        <span style={{fontSize:"12px",fontWeight:"700",color:T.text,width:"20px",textAlign:"right",flexShrink:0}}>{porDia[i]}</span>
                      </div>
                    ))}
                  </Panel>
                </div>

                {/* Ventas por hora */}
                {horasActivas.length>0 && (
                  <Panel>
                    <SecTitle>Flujo de Ventas por Hora</SecTitle>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(68px,1fr))",gap:"8px"}}>
                      {horasActivas.map(({h,v})=>{
                        const pct=v/maxHora;
                        const clr=pct>=0.8?"#dc2626":pct>=0.5?"#d97706":"#2563eb";
                        return (
                          <div key={h} style={{textAlign:"center"}}>
                            <div style={{height:"60px",display:"flex",alignItems:"flex-end",justifyContent:"center",marginBottom:"4px"}}>
                              <div style={{width:"32px",backgroundColor:clr,borderRadius:"4px 4px 0 0",height:`${Math.round(pct*60)}px`,minHeight:"4px",transition:"height 0.5s ease"}}/>
                            </div>
                            <div style={{fontSize:"11px",fontWeight:"700",color:T.text}}>{v}</div>
                            <div style={{fontSize:"10px",color:T.textSub}}>{fmtHora(h)}</div>
                          </div>
                        );
                      })}
                    </div>
                  </Panel>
                )}
              </>}
            </div>
          );
        })()}

        {/* ─── POS ────────────────────────────────────────────────────────── */}
        {seccionActiva==="registrar" && (
          <div style={{maxWidth:"520px"}}>
            <div style={S.card}>
              <h2 style={S.h1}>Registrar Venta</h2>
              <div style={S.field}>
                <label style={S.label}>Tipo de Documento</label>
                <select value={tipoDoc} onChange={e=>setTipoDoc(e.target.value)} style={{...S.input,fontWeight:"600"}}>
                  <option value="Recibo Interno">Recibo Interno</option>
                  <option value="Factura Electrónica">Factura Electrónica (DIAN)</option>
                </select>
              </div>

              <form onSubmit={registrarVenta}>
                {tipoDoc === "Recibo Interno" ? (
                  <>
                    <div style={S.field}>
                      <label style={S.label}>Cliente <span style={{fontWeight:400,color:T.textSub}}>(opcional)</span></label>
                      <input type="text" placeholder="Nombre del cliente" value={nombreCliente} onChange={e=>setNombreCliente(e.target.value)} style={S.input}/>
                    </div>
                    <div style={S.field}>
                      <label style={S.label}>{tipoNegocio==="tienda"?"Producto":"Servicio / Producto"}</label>
                      <input
                        type="text"
                        list="cat-sugerencias"
                        placeholder={tipoNegocio==="tienda"?"Ej: Arroz, panela...":"Ej: Corte de cabello, almuerzo..."}
                        value={concepto}
                        onChange={e=>{
                          setConcepto(e.target.value);
                          const item = servicios.find(s=>s.nombre===e.target.value);
                          if(item) setMonto(String(item.precio));
                        }}
                        style={S.input}
                        required
                        autoComplete="off"
                      />
                      <datalist id="cat-sugerencias">
                        {servicios.map(s=>(
                          <option key={s.id} value={s.nombre}>{s.nombre} — ${Number(s.precio).toLocaleString("es-CO")}</option>
                        ))}
                      </datalist>
                    </div>
                    <div style={S.field}>
                      <label style={S.label}>Valor ($)</label>
                      <input type="number" placeholder="0" value={monto} onChange={e=>setMonto(e.target.value)} style={S.input} required min="0"/>
                    </div>
                    <div style={S.field}>
                      <label style={S.label}>Método de Pago</label>
                      <select value={metodoPago} onChange={e=>setMetodoPago(e.target.value)} style={S.input}>
                        <option>Efectivo</option><option>Nequi</option><option>Daviplata</option><option value="Bancolombia">Transferencia</option><option>Tarjeta</option>
                      </select>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={S.secLabel}>Datos del Cliente</div>
                    <div style={S.row}>
                      <div style={{...S.field,flex:1}}><label style={S.label}>Identificación</label><input type="text" placeholder="NIT o Cédula" value={identificacion} onChange={e=>setIdentificacion(e.target.value)} style={S.input} required/></div>
                      <div style={{...S.field,flex:1}}><label style={S.label}>Nombre</label><input type="text" placeholder="Nombre completo" value={nombreCliente} onChange={e=>setNombreCliente(e.target.value)} style={S.input} required/></div>
                    </div>
                    <div style={S.row}>
                      <div style={{...S.field,flex:1}}><label style={S.label}>Correo</label><input type="email" placeholder="cliente@correo.com" value={correoCliente} onChange={e=>setCorreoCliente(e.target.value)} style={S.input} required/></div>
                      <div style={{...S.field,flex:1}}><label style={S.label}>Celular</label><input type="tel" placeholder="3001234567" value={celularCliente} onChange={e=>setCelularCliente(e.target.value)} style={S.input}/></div>
                    </div>
                    <div style={S.secLabel}>Detalle del Cobro</div>
                    <div style={S.field}>
                      <label style={S.label}>Concepto / Servicio</label>
                      <input type="text" list="cat-sugerencias-fe" placeholder="Ej: Corte de cabello" value={concepto} onChange={e=>{ setConcepto(e.target.value); const item=servicios.find(s=>s.nombre===e.target.value); if(item) setMonto(String(item.precio)); }} style={S.input} required autoComplete="off"/>
                      <datalist id="cat-sugerencias-fe">
                        {servicios.map(s=><option key={s.id} value={s.nombre}/>)}
                      </datalist>
                    </div>
                    <div style={S.row}>
                      <div style={{...S.field,flex:1}}><label style={S.label}>Valor ($)</label><input type="number" placeholder="0" value={monto} onChange={e=>setMonto(e.target.value)} style={S.input} required/></div>
                      <div style={{...S.field,flex:1}}><label style={S.label}>IVA</label>
                        <select value={tarifaIva} onChange={e=>setTarifaIva(e.target.value)} style={S.input}>
                          <option value="0">Exento (0%)</option><option value="19">General (19%)</option><option value="5">Especial (5%)</option>
                        </select>
                      </div>
                    </div>
                    <div style={S.field}><label style={S.label}>Método de Pago</label>
                      <select value={metodoPago} onChange={e=>setMetodoPago(e.target.value)} style={S.input}>
                        <option>Efectivo</option><option>Nequi</option><option>Daviplata</option><option value="Bancolombia">Transferencia</option><option>Tarjeta</option>
                      </select>
                    </div>
                  </>
                )}

                <button type="submit" disabled={procesandoAccion} style={S.btnPrimary(tipoDoc==="Factura Electrónica"?"#0284c7":"#0f172a")}>
                  {procesandoAccion?"Procesando...":tipoDoc==="Recibo Interno"?"Registrar":"Emitir Factura"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ─── HISTORIAL ──────────────────────────────────────────────────── */}
        {seccionActiva==="historial" && (
          <div style={S.card}>
            <h1 style={S.h1}>Historial de Ventas</h1>
            <p style={S.sub}>Comprobantes emitidos en el establecimiento.</p>
            {facturas.length===0 ? <p style={{color:"#64748b",fontSize:"13px",textAlign:"center",padding:"24px"}}>No hay transacciones registradas.</p> : (
              <>
                <div style={{overflowX:"auto"}}>
                  <table style={S.table}>
                    <thead><tr><th style={S.th}>Concepto</th><th style={S.th}>Cliente</th><th style={S.th}>Pago</th><th style={{...S.th,textAlign:"right"}}>Total</th><th style={{...S.th,textAlign:"center"}}>PDF</th></tr></thead>
                    <tbody>
                      {facturas.map(f=>(
                        <tr key={f.id}>
                          <td style={S.td}>
                            <div style={{fontWeight:"600"}}>{f.venta.concepto}</div>
                            <span style={S.badge(f.tipo_documento==="Factura Electrónica"?"#e0f2fe":"#f1f5f9", f.tipo_documento==="Factura Electrónica"?"#0369a1":"#475569")}>{f.tipo_documento==="Factura Electrónica"?"FE":"RI"}</span>
                          </td>
                          <td style={S.td}><div style={{fontWeight:"500"}}>{f.cliente.nombre}</div><div style={{fontSize:"11px",color:"#94a3b8"}}>{f.cliente.identificacion}</div></td>
                          <td style={S.td}><span style={S.tag()}>{f.venta.metodo_pago}</span></td>
                          <td style={{...S.td,textAlign:"right",fontWeight:"700"}}>${Number(f.venta.monto_total).toLocaleString("es-CO")}</td>
                          <td style={{...S.td,textAlign:"center"}}>
                            <button onClick={()=>descargarPDF(f)} style={{...S.btnSecondary,fontSize:"11px",padding:"5px 10px"}}>Descargar</button>
                            <div id={`cr-${f.id}`} style={{display:"none",fontFamily:"sans-serif",color:"#0f172a",padding:"20px",backgroundColor:"#fff"}}>
                              <div style={{borderBottom:"2px solid #0f172a",paddingBottom:"12px",marginBottom:"16px",display:"flex",justifyContent:"space-between"}}>
                                <div><h1 style={{fontSize:"22px",fontWeight:"800",margin:0}}>SOLDI</h1><p style={{fontSize:"11px",color:"#64748b",margin:"2px 0 0"}}>Plataforma Comercial</p></div>
                                <div style={{textAlign:"right"}}><h2 style={{fontSize:"13px",fontWeight:"700",margin:0,color:"#475569"}}>{f.tipo_documento.toUpperCase()}</h2><p style={{fontSize:"10px",color:"#64748b",margin:"2px 0 0"}}>ID: {f.id.toUpperCase()}</p></div>
                              </div>
                              <div style={{display:"flex",gap:"30px",marginBottom:"20px"}}>
                                <div style={{flex:1}}><p style={{fontSize:"11px",color:"#64748b",textTransform:"uppercase",marginBottom:"4px"}}>Cliente</p><p style={{fontWeight:"700",margin:"0 0 2px"}}>{f.cliente.nombre}</p><p style={{fontSize:"12px",margin:0}}>CC/NIT: {f.cliente.identificacion}</p><p style={{fontSize:"12px",margin:0}}>{f.cliente.correo}{f.cliente.celular&&f.cliente.celular!=="N/A"?` · ${f.cliente.celular}`:""}</p></div>
                                <div style={{flex:1}}><p style={{fontSize:"11px",color:"#64748b",textTransform:"uppercase",marginBottom:"4px"}}>Transacción</p><p style={{fontSize:"12px",margin:"0 0 3px"}}><strong>Fecha:</strong> {f.fecha_creacion?.seconds?new Date(f.fecha_creacion.seconds*1000).toLocaleString("es-CO"):new Date().toLocaleString("es-CO")}</p><p style={{fontSize:"12px",margin:"0 0 3px"}}><strong>Pago:</strong> {f.venta.metodo_pago}</p><p style={{fontSize:"12px",margin:0}}><strong>DIAN:</strong> {f.estado_dian}</p></div>
                              </div>
                              <table style={{width:"100%",borderCollapse:"collapse"}}>
                                <thead><tr><th style={{textAlign:"left",padding:"8px",backgroundColor:"#f8fafc",fontSize:"11px",fontWeight:"700",borderBottom:"2px solid #cbd5e1"}}>Concepto</th><th style={{textAlign:"center",padding:"8px",backgroundColor:"#f8fafc",fontSize:"11px",fontWeight:"700",borderBottom:"2px solid #cbd5e1"}}>IVA</th><th style={{textAlign:"right",padding:"8px",backgroundColor:"#f8fafc",fontSize:"11px",fontWeight:"700",borderBottom:"2px solid #cbd5e1",width:"110px"}}>Base</th><th style={{textAlign:"right",padding:"8px",backgroundColor:"#f8fafc",fontSize:"11px",fontWeight:"700",borderBottom:"2px solid #cbd5e1",width:"110px"}}>Total</th></tr></thead>
                                <tbody>
                                  <tr><td style={{padding:"10px 8px",fontSize:"12px",borderBottom:"1px solid #e2e8f0"}}>{f.venta.concepto}</td><td style={{padding:"10px 8px",fontSize:"12px",borderBottom:"1px solid #e2e8f0",textAlign:"center"}}>{f.venta.porcentaje_iva??0}%</td><td style={{padding:"10px 8px",fontSize:"12px",borderBottom:"1px solid #e2e8f0",textAlign:"right"}}>${Number(f.venta.base_gravable??f.venta.monto_total).toLocaleString("es-CO",{minimumFractionDigits:2})}</td><td style={{padding:"10px 8px",fontSize:"12px",borderBottom:"1px solid #e2e8f0",textAlign:"right",fontWeight:"600"}}>${Number(f.venta.monto_total).toLocaleString("es-CO",{minimumFractionDigits:2})}</td></tr>
                                  <tr><td colSpan="2" style={{padding:"5px 8px",textAlign:"right",fontSize:"11px",color:"#64748b"}}>IVA:</td><td colSpan="2" style={{padding:"5px 8px",textAlign:"right",fontSize:"11px",fontWeight:"600"}}>${Number(f.venta.valor_iva??0).toLocaleString("es-CO",{minimumFractionDigits:2})}</td></tr>
                                  <tr><td colSpan="2" style={{padding:"12px 8px",textAlign:"right",fontWeight:"700",fontSize:"12px"}}>TOTAL:</td><td colSpan="2" style={{padding:"12px 8px",textAlign:"right",fontWeight:"800",fontSize:"15px"}}>${Number(f.venta.monto_total).toLocaleString("es-CO",{minimumFractionDigits:2})}</td></tr>
                                </tbody>
                              </table>
                              <div style={{marginTop:"40px",textAlign:"center",borderTop:"1px dashed #cbd5e1",paddingTop:"12px"}}><p style={{fontSize:"10px",color:"#94a3b8",margin:0}}>Generado por Soldi v1.2</p></div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {hayMasFacturas&&<button onClick={cargarMasFacturas} disabled={cargandoHistorial} style={{width:"100%",marginTop:"16px",padding:"10px",borderRadius:"6px",border:"1px solid #cbd5e1",backgroundColor:"#fff",fontSize:"12px",color:"#475569",fontWeight:"600",cursor:"pointer"}}>{cargandoHistorial?"Cargando...":"Ver más registros"}</button>}
              </>
            )}
          </div>
        )}

        {/* ─── AGENDA DE CITAS ────────────────────────────────────────────── */}
        {seccionActiva==="agenda" && (
          <div>
            <h1 style={S.h1}>Agenda de Citas</h1>
            <p style={S.sub}>Gestione la disponibilidad y reservas del establecimiento.</p>

            {/* tabs */}
            <div style={{display:"flex",gap:"4px",backgroundColor:"#f1f5f9",padding:"4px",borderRadius:"8px",marginBottom:"20px",width:"fit-content"}}>
              {[["Ver Citas",0],["Nueva Cita",1],["Enlace Público",2]].map(([label,idx])=>(
                <button key={idx} onClick={()=>setTabAgenda(idx)} style={{padding:"8px 18px",borderRadius:"6px",border:"none",fontWeight:"600",fontSize:"13px",cursor:"pointer",backgroundColor:tabAgenda===idx?"#0f172a":"transparent",color:tabAgenda===idx?"#fff":"#64748b"}}>
                  {label}
                </button>
              ))}
            </div>

            {/* TAB 0: VER CITAS */}
            {tabAgenda===0 && (
              <div>
                {/* navegación de fecha */}
                <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"16px",flexWrap:"wrap"}}>
                  <button onClick={()=>moverFecha(-1)} style={S.btnSecondary}>← Anterior</button>
                  <span style={{fontWeight:"700",fontSize:"15px",color:T.text,flex:1,textAlign:"center",textTransform:"capitalize"}}>{fechaLarga(fechaAgenda)}</span>
                  <button onClick={()=>moverFecha(1)} style={S.btnSecondary}>Siguiente →</button>
                </div>

                {/* filtro por profesional */}
                {profesionales.length>0 && (
                  <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"16px"}}>
                    <button onClick={()=>setFiltroProfAgenda("todos")} style={{padding:"6px 12px",borderRadius:"20px",border:"1px solid",fontWeight:"600",fontSize:"12px",cursor:"pointer",backgroundColor:filtroProfAgenda==="todos"?"#0f172a":"#fff",color:filtroProfAgenda==="todos"?"#fff":"#64748b",borderColor:filtroProfAgenda==="todos"?"#0f172a":"#cbd5e1"}}>Todos</button>
                    {profesionales.map(p=>(
                      <button key={p.id} onClick={()=>setFiltroProfAgenda(filtroProfAgenda===p.id?"todos":p.id)} style={{padding:"6px 12px",borderRadius:"20px",border:"1px solid",fontWeight:"600",fontSize:"12px",cursor:"pointer",backgroundColor:filtroProfAgenda===p.id?"#0f172a":"#fff",color:filtroProfAgenda===p.id?"#fff":"#64748b",borderColor:filtroProfAgenda===p.id?"#0f172a":"#cbd5e1"}}>{p.nombre}</button>
                    ))}
                  </div>
                )}

                {/* lista de citas */}
                {cargandoCitas ? (
                  <div style={{...S.card,textAlign:"center",padding:"32px",color:"#64748b",fontSize:"13px"}}>Cargando citas...</div>
                ) : !diaActivo ? (
                  <div style={{...S.card,padding:"24px",backgroundColor:"#fff7ed",border:"1px solid #fed7aa",textAlign:"center"}}>
                    <p style={{fontWeight:"700",color:"#92400e",margin:0}}>Negocio cerrado los {nombreDia(fechaAgenda)}</p>
                    <p style={{fontSize:"12px",color:"#a16207",marginTop:"4px"}}>Puede configurar los días de atención en <strong>Horario de Atención</strong>.</p>
                  </div>
                ) : citasConfirmadas.length===0 ? (
                  <div style={{...S.card,padding:"32px",textAlign:"center"}}>
                    <p style={{color:"#64748b",fontSize:"14px",margin:0}}>No hay citas confirmadas para este día.</p>
                    <button onClick={()=>setTabAgenda(1)} style={{...S.btnSecondary,marginTop:"12px"}}>+ Agendar una cita</button>
                  </div>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                    {citasConfirmadas.map(c=>(
                      <div key={c.id} style={{...S.card,padding:"14px 16px"}}>
                        {/* fila principal */}
                        <div style={{display:"flex",alignItems:"center",gap:"12px",flexWrap:"wrap"}}>
                          <div style={{backgroundColor:"#0f172a",color:"#fff",borderRadius:"8px",padding:"8px 12px",fontWeight:"800",fontSize:"13px",minWidth:"70px",textAlign:"center",flexShrink:0}}>
                            {hora12(c.hora_inicio)}
                          </div>
                          <div style={{flex:1,minWidth:"120px"}}>
                            <div style={{fontWeight:"700",color:T.text,fontSize:"14px"}}>{c.cliente_nombre}</div>
                            <div style={{fontSize:"12px",color:T.textSub,marginTop:"2px"}}>
                              {c.servicio_nombre} · {c.servicio_duracion} min
                              {c.profesional_nombre&&c.profesional_nombre!=="Sin asignar"&&<> · <strong>{c.profesional_nombre}</strong></>}
                            </div>
                            {c.cliente_celular&&c.cliente_celular!=="N/A"&&<div style={{fontSize:"11px",color:"#94a3b8"}}>{c.cliente_celular}</div>}
                          </div>
                          <div style={{display:"flex",gap:"6px",flexShrink:0,flexWrap:"wrap"}}>
                            <span style={S.tag(c.origen==="online"?"#e0f2fe":"#f0fdf4",c.origen==="online"?"#0369a1":"#166534")}>{c.origen==="online"?"Online":"Manual"}</span>
                            {c.estado==="cobrada"
                              ? <span style={S.tag("#f0fdf4","#16a34a")}>Cobrada</span>
                              : <>
                                  <button onClick={()=>{ const sv=servicios.find(s=>s.nombre===c.servicio_nombre); setCitaACobrar(citaACobrar?.id===c.id?null:c); setCobrarMonto(sv?String(sv.precio):""); setCobrarMetodo("Efectivo"); }} style={{padding:"5px 10px",fontSize:"11px",fontWeight:"700",border:"1px solid #bbf7d0",borderRadius:"6px",backgroundColor:"#f0fdf4",color:"#16a34a",cursor:"pointer"}}>Cobrar</button>
                                  <button onClick={()=>cancelarCita(c.id)} style={{padding:"5px 10px",fontSize:"11px",fontWeight:"600",border:"1px solid #fecaca",borderRadius:"6px",backgroundColor:T.surface,color:"#dc2626",cursor:"pointer"}}>Cancelar</button>
                                </>
                            }
                          </div>
                        </div>

                        {/* panel cobro inline */}
                        {citaACobrar?.id===c.id && (
                          <div style={{marginTop:"12px",padding:"14px",backgroundColor:T.surfaceAlt,borderRadius:"10px",border:`1px solid ${T.border}`}}>
                            <p style={{fontSize:"13px",fontWeight:"700",color:T.text,margin:"0 0 10px"}}>Cobrar a {c.cliente_nombre}</p>
                            <div style={{display:"flex",gap:"10px",flexWrap:"wrap",alignItems:"flex-end"}}>
                              <div style={{...S.field,margin:0,flex:"1 1 120px"}}>
                                <label style={{...S.label,marginBottom:"4px"}}>Valor ($)</label>
                                <input type="number" min="0" value={cobrarMonto} onChange={e=>setCobrarMonto(e.target.value)} style={{...S.input,margin:0}} placeholder="0"/>
                              </div>
                              <div style={{...S.field,margin:0,flex:"1 1 140px"}}>
                                <label style={{...S.label,marginBottom:"4px"}}>Método de Pago</label>
                                <select value={cobrarMetodo} onChange={e=>setCobrarMetodo(e.target.value)} style={{...S.input,margin:0}}>
                                  <option>Efectivo</option><option>Nequi</option><option>Daviplata</option><option value="Bancolombia">Transferencia</option><option>Tarjeta</option>
                                </select>
                              </div>
                              <button onClick={cobrarCita} disabled={cobrandoCita||!cobrarMonto} style={{...S.btnPrimary("#16a34a"),margin:0,padding:"9px 18px",flexShrink:0}}>{cobrandoCita?"Registrando...":"Confirmar cobro"}</button>
                              <button onClick={()=>setCitaACobrar(null)} style={{...S.btnSecondary,margin:0,padding:"9px 14px",flexShrink:0}}>✕</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 1: NUEVA CITA */}
            {tabAgenda===1 && (
              <div style={{maxWidth:"520px"}}>
                <div style={S.card}>
                  <h3 style={{...S.h1,marginBottom:"4px"}}>Agendar Manualmente</h3>
                  <p style={S.sub}>Reserva una cita directamente desde la consola.</p>

                  {/* fecha con navegación */}
                  <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"16px"}}>
                    <button onClick={()=>moverFecha(-1)} style={S.btnSecondary}>←</button>
                    <input type="date" value={fechaAgenda} onChange={e=>setFechaAgenda(e.target.value)} style={{...S.input,flex:1,fontWeight:"700"}}/>
                    <button onClick={()=>moverFecha(1)} style={S.btnSecondary}>→</button>
                  </div>

                  {!diaActivo ? (
                    <div style={{padding:"14px",backgroundColor:"#fff7ed",borderRadius:"8px",color:"#92400e",fontSize:"13px",fontWeight:"600",marginBottom:"12px"}}>El negocio está cerrado los {nombreDia(fechaAgenda)}.</div>
                  ) : (
                    <>
                      <div style={S.row}>
                        <div style={{...S.field,flex:1}}>
                          <label style={S.label}>Servicio *</label>
                          <select value={ncServicioId} onChange={e=>{setNcServicioId(e.target.value);setNcSlot(null);}} style={S.input}>
                            <option value="">— Seleccionar —</option>
                            {servicios.map(s=><option key={s.id} value={s.id}>{s.nombre} ({s.duracion} min)</option>)}
                          </select>
                        </div>
                        <div style={{...S.field,flex:1}}>
                          <label style={S.label}>Profesional</label>
                          <select value={ncProfId} onChange={e=>setNcProfId(e.target.value)} style={S.input}>
                            <option value="">Sin asignar</option>
                            {profesionales.map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}
                          </select>
                        </div>
                      </div>

                      {ncServicioId && slotsNuevaCita.length===0 && <p style={{fontSize:"13px",color:"#64748b"}}>No hay turnos disponibles para este día con el horario configurado.</p>}

                      {ncServicioId && slotsNuevaCita.length>0 && (
                        <div style={{marginBottom:"16px"}}>
                          <label style={{...S.label,marginBottom:"8px",display:"block"}}>Horario disponible</label>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(100px,1fr))",gap:"6px"}}>
                            {slotsNuevaCita.map((sl,i)=>(
                              <button key={i} disabled={sl.ocupado} onClick={()=>setNcSlot(sl.ocupado?null:sl)} style={{padding:"9px 4px",borderRadius:"6px",border:`2px solid ${sl.ocupado?"#e2e8f0":ncSlot?.horaInicio===sl.horaInicio?"#0f172a":"#d1fae5"}`,backgroundColor:sl.ocupado?"#f8fafc":ncSlot?.horaInicio===sl.horaInicio?"#0f172a":"#f0fdf4",color:sl.ocupado?"#cbd5e1":ncSlot?.horaInicio===sl.horaInicio?"#fff":"#065f46",fontWeight:"700",fontSize:"12px",cursor:sl.ocupado?"not-allowed":"pointer",textAlign:"center"}}>
                                {hora12(sl.horaInicio)}
                                {sl.ocupado&&<div style={{fontSize:"9px",marginTop:"2px"}}>Ocupado</div>}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {ncSlot && (
                        <>
                          <div style={{padding:"10px 12px",backgroundColor:"#f0fdf4",borderRadius:"8px",marginBottom:"14px",fontSize:"13px",color:"#065f46",fontWeight:"600"}}>
                            Turno seleccionado: {hora12(ncSlot.horaInicio)} – {hora12(ncSlot.horaFin)}
                          </div>
                          <div style={S.row}>
                            <div style={{...S.field,flex:2}}><label style={S.label}>Nombre del Cliente *</label><input type="text" placeholder="Nombre completo" value={ncNombre} onChange={e=>setNcNombre(e.target.value)} style={S.input}/></div>
                            <div style={{...S.field,flex:1}}><label style={S.label}>Celular</label><input type="tel" placeholder="3001234567" value={ncCelular} onChange={e=>setNcCelular(e.target.value)} style={S.input}/></div>
                          </div>
                          <div style={{display:"flex",gap:"8px",marginTop:"4px"}}>
                            <button onClick={reservarCitaManual} disabled={guardandoNc||!ncNombre.trim()} style={{...S.btnPrimary(),flex:2,marginTop:0,opacity:!ncNombre.trim()?0.5:1}}>{guardandoNc?"Guardando...":"Confirmar Cita"}</button>
                            <button onClick={()=>setNcSlot(null)} style={{...S.btnSecondary,flex:1}}>Cancelar</button>
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {cargandoCitas && <p style={{fontSize:"12px",color:"#64748b",textAlign:"center",marginTop:"8px"}}>Verificando disponibilidad...</p>}
                </div>
              </div>
            )}

            {/* TAB 2: ENLACE PÚBLICO */}
            {tabAgenda===2 && (
              <div style={{maxWidth:"540px"}}>
                <div style={S.card}>
                  <h3 style={{...S.h1,marginBottom:"4px"}}>Enlace y QR de Reservas</h3>
                  <p style={S.sub}>Imprime el QR, ponlo en tu local o comparte el enlace — tus clientes reservan solos.</p>

                  {/* QR */}
                  <div style={{display:"flex",gap:"20px",alignItems:"flex-start",flexWrap:"wrap",marginBottom:"20px"}}>
                    <div style={{backgroundColor:"#fff",border:"1px solid #e2e8f0",borderRadius:"12px",padding:"12px",display:"inline-block"}}>
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(urlPublica)}&size=160x160&bgcolor=ffffff&color=0f172a&qzone=1`}
                        alt="QR de reservas"
                        width="160" height="160"
                        style={{display:"block",borderRadius:"4px"}}
                      />
                    </div>
                    <div style={{flex:1,minWidth:"180px"}}>
                      <p style={{fontWeight:"700",color:T.text,fontSize:"13px",margin:"0 0 6px"}}>Cómo usarlo:</p>
                      <ol style={{fontSize:"12px",color:T.textMuted,paddingLeft:"16px",margin:"0 0 14px",lineHeight:"2"}}>
                        <li>Imprime el QR o descárgalo</li>
                        <li>El cliente lo escanea con su cámara</li>
                        <li>Elige servicio, profesional, día y hora</li>
                        <li>La cita aparece aquí automáticamente</li>
                      </ol>
                      <a href={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(urlPublica)}&size=800x800&bgcolor=ffffff&color=0f172a`} download="qr-reservas.png" target="_blank" rel="noreferrer" style={{...S.btnSecondary,display:"inline-block",textDecoration:"none",fontSize:"12px"}}>
                        Descargar QR
                      </a>
                    </div>
                  </div>

                  {/* enlace */}
                  <div style={{backgroundColor:"#f8fafc",borderRadius:"8px",padding:"12px",marginBottom:"12px",wordBreak:"break-all",fontSize:"12px",color:"#334155",fontFamily:"monospace",border:"1px solid #e2e8f0"}}>
                    {urlPublica}
                  </div>
                  <button onClick={()=>{ navigator.clipboard.writeText(urlPublica).then(()=>alert("¡Enlace copiado al portapapeles!")); }} style={S.btnPrimary()}>
                    Copiar Enlace
                  </button>

                  {profesionales.length===0 && (
                    <div style={{marginTop:"14px",padding:"12px",backgroundColor:"#fff7ed",borderRadius:"8px",fontSize:"12px",color:"#92400e",border:"1px solid #fed7aa"}}>
                      <strong>Tip:</strong> Agrega profesionales en <strong>Profesionales</strong> para que tus clientes elijan con quién se atienden.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── CATÁLOGO ───────────────────────────────────────────────────── */}
        {seccionActiva==="servicios" && (
          <div>
            <div style={{...S.card,maxWidth:"600px",marginBottom:"16px"}}>
              <h2 style={S.h1}>{tipoNegocio==="barberia"?"Agregar Servicio":"Agregar Producto"}</h2>
              <p style={S.sub}>{tipoNegocio==="barberia"
                ?"Define servicios con precio y duración para la agenda automática."
                :"Define los productos o ítems con su precio para sugerirlos al registrar ventas."
              }</p>
              <form onSubmit={agregarServicio}>
                <div style={S.row}>
                  <div style={{...S.field,flex:2,minWidth:"160px"}}>
                    <label style={S.label}>{tipoNegocio==="barberia"?"Nombre del Servicio":"Nombre del Producto"}</label>
                    <input type="text" placeholder={tipoNegocio==="tienda"?"Ej: Arroz 500g":"Ej: Almuerzo del día"} value={nuevoServicio.nombre} onChange={e=>setNuevoServicio({...nuevoServicio,nombre:e.target.value})} style={S.input} required/>
                  </div>
                  <div style={{...S.field,flex:1,minWidth:"90px"}}>
                    <label style={S.label}>Precio ($)</label>
                    <input type="number" placeholder="0" min="0" value={nuevoServicio.precio} onChange={e=>setNuevoServicio({...nuevoServicio,precio:e.target.value})} style={S.input}/>
                  </div>
                  {tipoNegocio==="barberia" && (
                    <div style={{...S.field,flex:1,minWidth:"100px"}}>
                      <label style={S.label}>Duración</label>
                      <select value={nuevoServicio.duracion} onChange={e=>setNuevoServicio({...nuevoServicio,duracion:e.target.value})} style={S.input}>
                        <option value="15">15 min</option><option value="20">20 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="60">1 hora</option><option value="90">1h 30m</option><option value="120">2 horas</option>
                      </select>
                    </div>
                  )}
                </div>
                <button type="submit" disabled={guardandoServicio} style={S.btnPrimary()}>{guardandoServicio?"Guardando...":tipoNegocio==="barberia"?"Agregar Servicio":"Agregar Producto"}</button>
              </form>
            </div>
            <div style={{...S.card,maxWidth:"600px"}}>
              <h2 style={{...S.h1,marginBottom:"16px"}}>{tipoNegocio==="barberia"?"Servicios del Catálogo":"Productos del Catálogo"}</h2>
              {servicios.length===0 ? <p style={{color:T.textSub,fontSize:"13px",textAlign:"center",padding:"20px"}}>No hay {tipoNegocio==="barberia"?"servicios":"productos"} registrados.</p> : (
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>{tipoNegocio==="barberia"?"Servicio":"Producto"}</th>
                      <th style={{...S.th,textAlign:"right"}}>Precio</th>
                      {tipoNegocio==="barberia" && <th style={{...S.th,textAlign:"center"}}>Duración</th>}
                      <th style={{...S.th,textAlign:"center"}}>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {servicios.map(s=>(
                      <tr key={s.id}>
                        <td style={{...S.td,fontWeight:"600"}}>{s.nombre}</td>
                        <td style={{...S.td,textAlign:"right",fontWeight:"700"}}>${Number(s.precio).toLocaleString("es-CO")}</td>
                        {tipoNegocio==="barberia" && <td style={{...S.td,textAlign:"center"}}><span style={S.tag("#f0fdf4","#166534")}>{s.duracion} min</span></td>}
                        <td style={{...S.td,textAlign:"center"}}><button onClick={()=>eliminarServicio(s.id)} style={{padding:"5px 10px",fontSize:"11px",fontWeight:"600",border:"1px solid #fecaca",borderRadius:"6px",backgroundColor:T.surface,color:"#dc2626",cursor:"pointer"}}>Eliminar</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ─── PROFESIONALES ──────────────────────────────────────────────── */}
        {seccionActiva==="profesionales" && (
          <div>
            <div style={{...S.card,maxWidth:"560px",marginBottom:"16px"}}>
              <h2 style={S.h1}>Agregar Profesional</h2>
              <p style={S.sub}>Los profesionales aparecerán en el enlace público para que los clientes los elijan.</p>
              <form onSubmit={agregarProfesional}>
                <div style={S.row}>
                  <div style={{...S.field,flex:2,minWidth:"160px"}}><label style={S.label}>Nombre</label><input type="text" placeholder="Ej: Juan Gómez" value={nuevoProfesional.nombre} onChange={e=>setNuevoProfesional({...nuevoProfesional,nombre:e.target.value})} style={S.input} required/></div>
                  <div style={{...S.field,flex:1,minWidth:"130px"}}><label style={S.label}>Especialidad (opcional)</label><input type="text" placeholder="Ej: Cortes y Barba" value={nuevoProfesional.especialidad} onChange={e=>setNuevoProfesional({...nuevoProfesional,especialidad:e.target.value})} style={S.input}/></div>
                </div>
                <button type="submit" disabled={guardandoProfesional} style={S.btnPrimary()}>{guardandoProfesional?"Guardando...":"Agregar Profesional"}</button>
              </form>
            </div>
            <div style={{...S.card,maxWidth:"560px"}}>
              <h2 style={{...S.h1,marginBottom:"16px"}}>Equipo del Establecimiento</h2>
              {profesionales.length===0 ? (
                <div style={{textAlign:"center",padding:"24px"}}>
                  <p style={{color:"#64748b",fontSize:"13px"}}>No hay profesionales registrados.</p>
                  <p style={{color:"#94a3b8",fontSize:"12px"}}>Los clientes verán "Cualquier disponible" en el enlace de reservas.</p>
                </div>
              ) : (
                <table style={S.table}>
                  <thead><tr><th style={S.th}>Nombre</th><th style={S.th}>Especialidad</th><th style={{...S.th,textAlign:"center"}}>Acción</th></tr></thead>
                  <tbody>
                    {profesionales.map(p=>(
                      <tr key={p.id}>
                        <td style={{...S.td,fontWeight:"700"}}>{p.nombre}</td>
                        <td style={S.td}><span style={S.tag()}>{p.especialidad||"—"}</span></td>
                        <td style={{...S.td,textAlign:"center"}}><button onClick={()=>eliminarProfesional(p.id)} style={{padding:"5px 10px",fontSize:"11px",fontWeight:"600",border:"1px solid #fecaca",borderRadius:"6px",backgroundColor:"#fff",color:"#dc2626",cursor:"pointer"}}>Eliminar</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ─── PERFIL DEL NEGOCIO ─────────────────────────────────────────── */}
        {seccionActiva==="perfil" && (
          <div style={{maxWidth:"520px"}}>
            <div style={S.card}>
              <h2 style={S.h1}>Perfil del Negocio</h2>
              <p style={S.sub}>Esta información aparece en la página pública de reservas que ven tus clientes.</p>

              {/* preview */}
              <div style={{backgroundColor:"#0f172a",borderRadius:"10px",padding:"20px",textAlign:"center",marginBottom:"20px"}}>
                {perfilNegocio.logo_url
                  ? <img src={perfilNegocio.logo_url} alt="logo" style={{width:"60px",height:"60px",borderRadius:"50%",objectFit:"cover",border:"3px solid rgba(255,255,255,0.2)",marginBottom:"10px"}}/>
                  : <div style={{width:"60px",height:"60px",borderRadius:"50%",backgroundColor:"#1e293b",border:"3px solid rgba(255,255,255,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"24px",fontWeight:"800",color:"#f59e0b",margin:"0 auto 10px"}}>
                      {(perfilNegocio.nombre_comercial||"?")[0].toUpperCase()}
                    </div>}
                <div style={{fontWeight:"800",color:"#fff",fontSize:"16px"}}>{perfilNegocio.nombre_comercial||"Nombre del negocio"}</div>
                {perfilNegocio.tagline && <div style={{color:"#94a3b8",fontSize:"12px",marginTop:"3px"}}>{perfilNegocio.tagline}</div>}
                <div style={{fontSize:"10px",color:"#475569",marginTop:"6px"}}>Vista previa del encabezado público</div>
              </div>

              <form onSubmit={guardarPerfil}>
                <div style={S.field}>
                  <label style={S.label}>Nombre del Negocio</label>
                  <input type="text" placeholder="Ej: Barbería El Estilo" value={perfilNegocio.nombre_comercial} onChange={e=>setPerfilNegocio({...perfilNegocio,nombre_comercial:e.target.value})} style={S.input}/>
                </div>
                <div style={S.field}>
                  <label style={S.label}>Eslogan / Descripción corta</label>
                  <input type="text" placeholder="Ej: Tu estilo, nuestra pasión" value={perfilNegocio.tagline} onChange={e=>setPerfilNegocio({...perfilNegocio,tagline:e.target.value})} style={S.input}/>
                </div>
                <div style={S.field}>
                  <label style={S.label}>URL del Logo o Foto</label>
                  <input type="url" placeholder="https://..." value={perfilNegocio.logo_url} onChange={e=>setPerfilNegocio({...perfilNegocio,logo_url:e.target.value})} style={S.input}/>
                  <p style={{fontSize:"11px",color:"#94a3b8",marginTop:"5px"}}>Sube tu imagen a <strong>imgbb.com</strong> o <strong>imgur.com</strong> y pega el enlace directo aquí.</p>
                </div>
                <button type="submit" disabled={guardandoPerfil} style={S.btnPrimary()}>{guardandoPerfil?"Guardando...":"Guardar Perfil"}</button>
              </form>
            </div>
          </div>
        )}

        {/* ─── VALERAS (RESTAURANTE) ──────────────────────────────────────── */}
        {seccionActiva==="valeras" && (
          <div>
            <h1 style={S.h1}>Sistema de Valeras</h1>
            <p style={S.sub}>Gestiona los tiquetes de almuerzos de tus clientes.</p>

            {/* form nueva valera */}
            <div style={{...S.card,maxWidth:"560px",marginBottom:"16px"}}>
              <h2 style={{...S.h1,fontSize:"16px",marginBottom:"4px"}}>Nueva Valera</h2>
              <p style={S.sub}>Crea una valera para un cliente con una cantidad inicial de almuerzos.</p>
              <form onSubmit={crearValera}>
                <div style={S.row}>
                  <div style={{...S.field,flex:2}}><label style={S.label}>Nombre del cliente</label><input type="text" placeholder="Nombre completo" value={nuevaValera.nombre} onChange={e=>setNuevaValera({...nuevaValera,nombre:e.target.value})} style={S.input} required/></div>
                  <div style={{...S.field,flex:1}}><label style={S.label}>Celular</label><input type="tel" placeholder="300..." value={nuevaValera.celular} onChange={e=>setNuevaValera({...nuevaValera,celular:e.target.value})} style={S.input}/></div>
                  <div style={{...S.field,flex:1}}><label style={S.label}>Almuerzos</label><input type="number" min="1" value={nuevaValera.cantidad} onChange={e=>setNuevaValera({...nuevaValera,cantidad:e.target.value})} style={S.input}/></div>
                </div>
                <button type="submit" disabled={guardandoValera} style={S.btnPrimary("#f59e0b")}>{guardandoValera?"Guardando...":"Crear Valera"}</button>
              </form>
            </div>

            {/* lista de valeras */}
            {valeras.length === 0
              ? <div style={{...S.card,textAlign:"center",padding:"32px",color:"#64748b",fontSize:"14px"}}>No hay valeras registradas. Crea la primera arriba.</div>
              : <div style={{display:"flex",flexDirection:"column",gap:"10px",maxWidth:"680px"}}>
                {valeras.map(v => {
                  const color = v.saldo === 0 ? "#dc2626" : v.saldo <= 3 ? "#d97706" : "#16a34a";
                  const bg = v.saldo === 0 ? "#fee2e2" : v.saldo <= 3 ? "#fef3c7" : "#dcfce7";
                  return (
                    <div key={v.id} style={{...S.card,padding:"14px 16px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:"14px",flexWrap:"wrap"}}>
                        <div style={{flex:1,minWidth:"120px"}}>
                          <div style={{fontWeight:"700",color:T.text,fontSize:"15px"}}>{v.cliente_nombre}</div>
                          {v.cliente_celular !== "N/A" && <div style={{fontSize:"12px",color:T.textSub}}>{v.cliente_celular}</div>}
                        </div>
                        <div style={{backgroundColor:bg,color,borderRadius:"10px",padding:"8px 16px",fontWeight:"800",fontSize:"20px",textAlign:"center",minWidth:"70px"}}>
                          {v.saldo}
                          <div style={{fontSize:"10px",fontWeight:"600"}}>almuerzos</div>
                        </div>
                        <div style={{display:"flex",gap:"6px",alignItems:"center",flexWrap:"wrap"}}>
                          <button onClick={()=>descontarAlmuerzo(v)} disabled={v.saldo<=0} style={{padding:"7px 14px",fontSize:"12px",fontWeight:"700",border:"none",borderRadius:"6px",cursor:v.saldo>0?"pointer":"not-allowed",backgroundColor:v.saldo>0?"#0f172a":"#f1f5f9",color:v.saldo>0?"#fff":"#cbd5e1"}}>
                            − 1 almuerzo
                          </button>
                          <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
                            <input type="number" min="1" placeholder="Cant" value={recargaVal[v.id]||""} onChange={e=>setRecargaVal(prev=>({...prev,[v.id]:e.target.value}))} style={{...S.input,width:"60px",padding:"7px 8px",fontSize:"12px"}}/>
                            <button onClick={()=>recargarValera(v)} style={{padding:"7px 10px",fontSize:"12px",fontWeight:"700",border:"1px solid #16a34a",borderRadius:"6px",cursor:"pointer",backgroundColor:"#f0fdf4",color:"#16a34a"}}>+ Recargar</button>
                          </div>
                          <button onClick={()=>setValeraHistOpen(p=>({...p,[v.id]:!p[v.id]}))} style={{padding:"7px 10px",fontSize:"11px",fontWeight:"600",border:"1px solid #e2e8f0",borderRadius:"6px",cursor:"pointer",backgroundColor:"#f8fafc",color:"#475569"}}>
                            {valeraHistOpen[v.id] ? "Ocultar" : `Historial (${(v.usos||[]).length})`}
                          </button>
                          <button onClick={()=>eliminarValera(v.id)} style={{padding:"7px 10px",fontSize:"11px",fontWeight:"600",border:"1px solid #fecaca",borderRadius:"6px",cursor:"pointer",backgroundColor:"#fff",color:"#dc2626"}}>Eliminar</button>
                        </div>
                      </div>
                      {valeraHistOpen[v.id] && (
                        <div style={{marginTop:"12px",borderTop:"1px solid #f1f5f9",paddingTop:"10px"}}>
                          {(v.usos||[]).length === 0
                            ? <p style={{fontSize:"12px",color:"#94a3b8",margin:0}}>Sin usos registrados aún.</p>
                            : <div style={{display:"flex",flexDirection:"column",gap:"4px",maxHeight:"180px",overflowY:"auto"}}>
                              {[...(v.usos||[])].sort((a,b)=>{
                                const ta = a?.fecha?.seconds || a?.seconds || 0;
                                const tb = b?.fecha?.seconds || b?.seconds || 0;
                                return tb - ta;
                              }).map((u,i)=>{
                                const raw = u?.fecha || u;
                                const fecha = raw?.toDate ? raw.toDate() : raw?.seconds ? new Date(raw.seconds*1000) : new Date(raw);
                                const esDescuento = !u?.tipo || u.tipo === "descuento";
                                const cantidad = u?.cantidad ?? 1;
                                const saldoRes = u?.saldo_resultante ?? "—";
                                return (
                                  <div key={i} style={{display:"flex",alignItems:"center",gap:"8px",fontSize:"12px",padding:"5px 0",borderBottom:"1px solid #f8fafc",flexWrap:"wrap"}}>
                                    <span style={{fontSize:"10px",borderRadius:"4px",padding:"2px 8px",fontWeight:"700",flexShrink:0,backgroundColor:esDescuento?"#fee2e2":"#dcfce7",color:esDescuento?"#dc2626":"#16a34a"}}>
                                      {esDescuento ? `−${cantidad}` : `+${cantidad}`}
                                    </span>
                                    <span style={{color:"#475569"}}>{fecha.toLocaleDateString("es-CO",{weekday:"short",day:"numeric",month:"short"})}</span>
                                    <span style={{fontWeight:"600",color:"#0f172a"}}>{fecha.toLocaleTimeString("es-CO",{hour:"2-digit",minute:"2-digit"})}</span>
                                    <span style={{marginLeft:"auto",fontSize:"11px",color:"#64748b",flexShrink:0}}>saldo: <strong style={{color:"#0f172a"}}>{saldoRes}</strong></span>
                                  </div>
                                );
                              })}
                            </div>
                          }
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            }
          </div>
        )}

        {/* ─── FIAR (TIENDA) ──────────────────────────────────────────────── */}
        {seccionActiva==="fiar" && (
          <div style={{display:"flex",gap:"16px",flexWrap:"wrap",alignItems:"flex-start"}}>

            {/* columna izquierda: lista de fiados */}
            <div style={{flex:"1 1 280px",minWidth:"280px"}}>
              <h1 style={S.h1}>Sistema de Fiar</h1>
              <p style={S.sub}>Controla las deudas y pagos de tus clientes fiados.</p>

              {/* form nuevo fiado */}
              <div style={{...S.card,marginBottom:"14px"}}>
                <h3 style={{...S.h1,fontSize:"15px",marginBottom:"12px"}}>Nuevo Fiado</h3>
                <form onSubmit={crearFiado}>
                  <div style={S.field}><label style={S.label}>Nombre</label><input type="text" placeholder="Nombre del cliente" value={nuevoFiado.nombre} onChange={e=>setNuevoFiado({...nuevoFiado,nombre:e.target.value})} style={S.input} required/></div>
                  <div style={S.field}><label style={S.label}>Celular (opcional)</label><input type="tel" placeholder="300..." value={nuevoFiado.celular} onChange={e=>setNuevoFiado({...nuevoFiado,celular:e.target.value})} style={S.input}/></div>
                  <button type="submit" disabled={guardandoFiado} style={S.btnPrimary()}>{guardandoFiado?"Guardando...":"Crear Fiado"}</button>
                </form>
              </div>

              {/* lista */}
              {fiados.length === 0
                ? <div style={{...S.card,textAlign:"center",padding:"24px",color:"#64748b",fontSize:"13px"}}>No hay fiados registrados.</div>
                : <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                  {fiados.map(f => (
                    <div key={f.id} onClick={()=>abrirFiado(f)} style={{...S.card,padding:"12px 14px",cursor:"pointer",border:fiadoAbierto?.id===f.id?"2px solid #0f172a":"1px solid #e2e8f0",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div>
                        <div style={{fontWeight:"700",color:T.text,fontSize:"14px"}}>{f.cliente_nombre}</div>
                        {f.cliente_celular !== "N/A" && <div style={{fontSize:"11px",color:T.textSub}}>{f.cliente_celular}</div>}
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontWeight:"800",fontSize:"15px",color:f.deuda>0?"#dc2626":"#16a34a"}}>${Number(f.deuda||0).toLocaleString("es-CO")}</div>
                        <div style={{fontSize:"10px",color:"#94a3b8"}}>{f.deuda>0?"debe":"al día"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              }
            </div>

            {/* columna derecha: detalle del fiado seleccionado */}
            {fiadoAbierto && (
              <div style={{flex:"2 1 340px",minWidth:"300px"}}>
                <div style={S.card}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"16px",flexWrap:"wrap",gap:"8px"}}>
                    <div>
                      <h2 style={{...S.h1,margin:0}}>{fiadoAbierto.cliente_nombre}</h2>
                      <div style={{fontSize:"13px",color:"#64748b",marginTop:"2px"}}>Deuda: <strong style={{color:fiadoAbierto.deuda>0?"#dc2626":"#16a34a"}}>${Number(fiadoAbierto.deuda||0).toLocaleString("es-CO")}</strong></div>
                    </div>
                    <div style={{display:"flex",gap:"6px"}}>
                      <button onClick={()=>eliminarFiado(fiadoAbierto.id)} style={{padding:"6px 10px",fontSize:"11px",fontWeight:"600",border:"1px solid #fecaca",borderRadius:"6px",cursor:"pointer",backgroundColor:"#fff",color:"#dc2626"}}>Eliminar</button>
                      <button onClick={()=>setFiadoAbierto(null)} style={S.btnSecondary}>Cerrar</button>
                    </div>
                  </div>

                  {/* agregar movimiento */}
                  <div style={{backgroundColor:"#f8fafc",borderRadius:"8px",padding:"14px",marginBottom:"16px",border:"1px solid #e2e8f0"}}>
                    <div style={S.row}>
                      <div style={{...S.field,flex:1,minWidth:"100px"}}>
                        <label style={S.label}>Tipo</label>
                        <select value={movFiado.tipo} onChange={e=>setMovFiado({...movFiado,tipo:e.target.value})} style={S.input}>
                          <option value="cargo">Fiar (cargo)</option>
                          <option value="pago">Pago (abono)</option>
                        </select>
                      </div>
                      <div style={{...S.field,flex:2,minWidth:"140px"}}>
                        <label style={S.label}>Concepto</label>
                        <input type="text" placeholder={movFiado.tipo==="cargo"?"¿Qué fió?":"¿Qué pagó?"} value={movFiado.concepto} onChange={e=>setMovFiado({...movFiado,concepto:e.target.value})} style={S.input}/>
                      </div>
                      <div style={{...S.field,flex:1,minWidth:"90px"}}>
                        <label style={S.label}>Valor ($)</label>
                        <input type="number" min="1" placeholder="0" value={movFiado.monto} onChange={e=>setMovFiado({...movFiado,monto:e.target.value})} style={S.input}/>
                      </div>
                    </div>
                    <button onClick={agregarMovFiado} disabled={guardandoMovFiado||!movFiado.monto} style={{...S.btnPrimary(movFiado.tipo==="cargo"?"#dc2626":"#16a34a"),marginTop:0,opacity:!movFiado.monto?0.5:1}}>
                      {guardandoMovFiado?"Guardando...":(movFiado.tipo==="cargo"?"Registrar Fiado":"Registrar Pago")}
                    </button>
                  </div>

                  {/* historial de movimientos */}
                  <p style={{...S.secLabel,marginTop:0}}>Historial</p>
                  {cargandoMovs && <p style={{color:"#64748b",fontSize:"13px",textAlign:"center"}}>Cargando...</p>}
                  {!cargandoMovs && movimientos.length === 0 && <p style={{color:"#94a3b8",fontSize:"13px",textAlign:"center",padding:"16px"}}>Sin movimientos aún.</p>}
                  {movimientos.map(m => (
                    <div key={m.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:"1px solid #f1f5f9",fontSize:"13px"}}>
                      <div>
                        <span style={{...S.tag(m.tipo==="cargo"?"#fee2e2":"#dcfce7",m.tipo==="cargo"?"#dc2626":"#16a34a"),marginRight:"8px"}}>{m.tipo==="cargo"?"Fiado":"Pago"}</span>
                        {m.concepto}
                      </div>
                      <div style={{fontWeight:"700",color:m.tipo==="cargo"?"#dc2626":"#16a34a",flexShrink:0,marginLeft:"8px"}}>
                        {m.tipo==="cargo"?"+":"-"}${Number(m.monto).toLocaleString("es-CO")}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── HORARIO DE ATENCIÓN ────────────────────────────────────────── */}
        {seccionActiva==="configuracion" && (
          <div style={{maxWidth:"520px"}}>
            <div style={S.card}>
              <h2 style={S.h1}>Horario de Atención</h2>
              <p style={S.sub}>Configure su horario de apertura y cierre. La agenda se genera automáticamente dentro de esta franja con la duración de cada servicio.</p>
              <form onSubmit={guardarConfigAgenda}>
                <div style={S.secLabel}>Horas de Operación</div>
                <div style={S.row}>
                  <div style={{...S.field,flex:1}}><label style={S.label}>Apertura</label><input type="time" value={configAgenda.hora_inicio} onChange={e=>setConfigAgenda({...configAgenda,hora_inicio:e.target.value})} style={S.input}/></div>
                  <div style={{...S.field,flex:1}}><label style={S.label}>Cierre</label><input type="time" value={configAgenda.hora_fin} onChange={e=>setConfigAgenda({...configAgenda,hora_fin:e.target.value})} style={S.input}/></div>
                </div>
                <div style={S.secLabel}>Días de Atención</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:"8px",marginBottom:"20px"}}>
                  {["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"].map(dia=>{
                    const activo=(configAgenda.dias_activos||[]).includes(dia);
                    return <button key={dia} type="button" onClick={()=>toggleDia(dia)} style={{padding:"8px 14px",borderRadius:"6px",border:`1px solid ${activo?"#0f172a":"#cbd5e1"}`,backgroundColor:activo?"#0f172a":"#fff",color:activo?"#fff":"#64748b",fontSize:"13px",fontWeight:"600",cursor:"pointer"}}>{dia}</button>;
                  })}
                </div>
                <button type="submit" disabled={guardandoConfig} style={S.btnPrimary()}>{guardandoConfig?"Guardando...":"Guardar Horario"}</button>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;
