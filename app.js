"use strict";
// Version para compartir: solo muestra el estado actual de data/stock.enc.json.
// Sin historico, sin cambios y sin descargas. Los datos van cifrados (lo hace check.ps1):
// PBKDF2-SHA256 de la contrasena -> 64 bytes = clave AES-256-CBC + clave HMAC-SHA256.
(function () {
  const COLS = [
    { k: "modelo",     t: "Modelo" },
    { k: "ref",        t: "Referencia" },
    { k: "escala",     t: "Escala",    soloBF: true },
    { k: "stock",      t: "Stock",     num: true },
    { k: "tirada",     t: "Tirada",    num: true },
    { k: "vendidoPct", t: "% vendido", num: true, soloClub: true, tip: "Estimado: (tirada - stock disponible) / tirada x 100" },
    { k: "precio",     t: "Precio",    num: true },
  ];
  const NIVELES = ["crit", "low", "ok"];
  const BF = "BlackFriday";
  const estado = { datos: null, sec: "Club", q: "", orden: null, dir: 1 };
  try { const s = localStorage.getItem("stock-otto-sec"); if (s === "Tienda" || s === BF) estado.sec = s; } catch (e) {}

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nombre = m => String(m || "").replace(/^OttOmobile\s*-\s*.*?\bOT\d+\s*-\s*/i, "");
  const entero = v => Number.isInteger(v) ? v : null;
  const precioNum = p => parseFloat(String(p || "").replace(/[^\d.]/g, "")) || null;
  // Solo se enlaza a fichas de otto-models.com.
  const urlSegura = u => /^https:\/\/otto-models\.com\/[\w\-./]+\.html$/.test(String(u || "")) ? u : null;

  function fechaLocal(s) { // "yyyy-MM-dd HH:mm" en hora de Madrid
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(s || ""));
    return m ? { y: +m[1], mo: +m[2], da: +m[3], hh: +m[4], mi: +m[5] } : null;
  }
  function haceMin(f) {
    const madrid = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
    return Math.round((madrid - new Date(f.y, f.mo - 1, f.da, f.hh, f.mi)) / 60000);
  }
  const dos = n => String(n).padStart(2, "0");

  // --- Formato de presentacion ---
  const numero = n => n.toLocaleString("es-ES");
  // Nombre para mostrar: quita "OttOmobile - Marca REF - " sea cual sea el formato de la referencia.
  const nombreVisible = m => nombre(m).replace(/^OttOmobile\s*-\s*.*?\b[A-Z]{1,3}\d+\s*-\s*/i, "");
  const precioTxt = p => { const n = precioNum(p); return n == null ? String(p || "") : n.toLocaleString("es-ES", { style: "currency", currency: "EUR" }); };
  const menos = s => s.replace(/^-/, "−");
  function cuando(f) {
    const hoy = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
    const dia = hoy.getFullYear() === f.y && hoy.getMonth() + 1 === f.mo && hoy.getDate() === f.da ? "hoy" : `el ${dos(f.da)}/${dos(f.mo)}`;
    return `${dia} a las ${dos(f.hh)}:${dos(f.mi)}`;
  }
  function hace(min) {
    if (min < 1) return "ahora mismo";
    return "hace " + (min < 60 ? min + " min" : Math.floor(min / 60) + " h" + (min % 60 ? " " + (min % 60) + " min" : ""));
  }
  const vacia = (texto, cols, cargando) =>
    `<tr class="vacia"><td class="empty" colspan="${cols}">${cargando ? '<span class="spinner" aria-hidden="true"></span>' : ""}${texto}</td></tr>`;

  // --- Black Friday: no tiene datos propios, son los modelos de la Tienda a mitad de precio ---
  // Hasta BF_DESDE (hora de Madrid) la pestana solo avisa de cuando vuelve. Desde ese dia muestra los
  // de la Tienda cuya ficha trae un descuento de al menos el 50 % sobre su precio normal.
  const BF_DESDE = "2026-11-28", BF_TEXTO = "Vuelve el 28 de noviembre";
  const MITAD = 49;   // % de descuento minimo (redondeado): 69,90 -> 34,95 es un 50 %
  const ahoraMadrid = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
  const hoyMadrid = () => { const d = ahoraMadrid(); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`; };
  const bfActivo = () => hoyMadrid() >= BF_DESDE;
  const seccionDatos = () => estado.sec === BF ? "Tienda" : estado.sec;
  const escala = p => /^OT\d/i.test(p.ref || "") ? "1:18" : /^G\d/i.test(p.ref || "") ? "1:12" : null;
  const NO_MODELO = /gift[\s-]*card|tarjeta[\s-]*regalo|cleaning[\s-]*kit|kit[\s-]*de[\s-]*limpieza/i;
  const productosBF = () => !bfActivo() ? [] : (estado.datos?.secciones?.Tienda?.productos || [])
    .filter(p => p.descuento >= MITAD && !NO_MODELO.test(p.modelo + " " + p.url));
  function todos() { return estado.sec === BF ? productosBF() : estado.datos?.secciones?.[estado.sec]?.productos || []; }

  // Si la ficha esta rebajada, el precio normal sale tachado al lado del actual.
  function precioCelda(p) {
    if (!p.precioAntes || precioNum(p.precioAntes) == null) return esc(precioTxt(p.precio));
    return `<s class="precio-antes">${esc(precioTxt(p.precioAntes))}</s><span class="precio-bf">${esc(precioTxt(p.precio))}</span>`;
  }

  const productos = () => filtrarOrdenar(todos());
  function filtrarOrdenar(base) {
    let lista = base.slice();
    const q = estado.q.trim().toLowerCase();
    if (q) lista = lista.filter(p => (nombre(p.modelo) + " " + p.ref).toLowerCase().includes(q));
    if (estado.orden) {
      const k = estado.orden, val = p => k === "precio" ? precioNum(p.precio) : k === "modelo" ? nombre(p.modelo) : k === "escala" ? escala(p) : p[k];
      lista.sort((a, b) => {
        const va = val(a), vb = val(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return (typeof va === "string" ? va.localeCompare(vb, "es") : va - vb) * estado.dir;
      });
    }
    return lista;
  }

  function fila(p, cols) {
    const nivel = NIVELES.includes(p.nivel) ? p.nivel : "ok";
    const url = urlSegura(p.url), stock = entero(p.stock), tirada = entero(p.tirada);
    const pct = typeof p.vendidoPct === "number" ? p.vendidoPct : null;
    const titulo = esc(nombreVisible(p.modelo));
    const celdas = {
      modelo: `<td class="modelo">${url
        ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${titulo}">${titulo}</a>`
        : titulo}</td>`,
      ref: `<td class="extra dim" data-label="">${esc(p.ref)}</td>`,
      escala: `<td class="extra dim" data-label="">${escala(p) || ""}</td>`,
      stock: `<td class="num stock-cell"><span class="stock ${nivel}">${stock == null ? "–" : numero(stock)}</span></td>`,
      tirada: `<td class="extra num dim${tirada ? "" : " vacio"}" data-label="Tirada">${tirada ? numero(tirada) : ""}</td>`,
      vendidoPct: `<td class="extra num dim${pct == null ? " vacio" : ""}" data-label="Vendido">${pct == null ? "–"
        : `<span class="meter" aria-hidden="true"><span class="meter-fill" data-pct="${Math.min(100, Math.max(0, pct))}"></span></span><span class="pct">${pct.toLocaleString("es-ES")} %</span>`}</td>`,
      precio: `<td class="extra num dim${p.precio ? "" : " vacio"}" data-label="">${precioCelda(p)}</td>`,
    };
    return "<tr>" + cols.map(c => celdas[c.k]).join("") + "</tr>";
  }

  // Indicador del control segmentado: se coloca bajo la pestana elegida (anchos distintos en movil).
  function moverIndicador() {
    const t = $("tabs"), sel = t.querySelector('.tab[aria-selected="true"]');
    if (!sel || !sel.offsetWidth) return;
    t.style.setProperty("--x", sel.offsetLeft - 2 + "px");
    t.style.setProperty("--w", sel.offsetWidth + "px");
    if (!t.classList.contains("listo")) requestAnimationFrame(() => t.classList.add("listo"));
  }
  window.addEventListener("resize", moverIndicador);

  function pintar() {
    const cols = COLS.filter(c => (!c.soloClub || estado.sec === "Club") && (!c.soloBF || estado.sec === BF));
    document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", b.dataset.sec === estado.sec));
    $("tabs").dataset.sel = estado.sec;
    moverIndicador();
    pintarBoton();
    for (const sec of ["Club", "Tienda"]) {
      const n = estado.datos?.secciones?.[sec]?.productos?.length;
      $("n-" + sec).textContent = n ? n : "";
    }
    $("n-" + BF).textContent = productosBF().length || "";

    $("cabecera").innerHTML = cols.map(c => {
      const dir = estado.orden === c.k ? (estado.dir > 0 ? "asc" : "desc") : null;
      return `<th class="${c.num ? "num" : ""}" data-k="${c.k}" tabindex="0"${c.tip ? ` title="${esc(c.tip)}"` : ""}${
        dir ? ` data-dir="${dir}" aria-sort="${dir === "asc" ? "ascending" : "descending"}"` : ""}>${c.t}</th>`;
    }).join("");
    $("cabecera").querySelectorAll("th").forEach(th => {
      th.addEventListener("click", () => {
        const k = th.dataset.k;
        if (estado.orden === k) { if (estado.dir > 0) estado.dir = -1; else estado.orden = null; }
        else { estado.orden = k; estado.dir = 1; }
        pintar();
        $("cabecera").querySelector(`th[data-k="${k}"]`)?.focus({ preventScroll: true });
      });
      th.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); th.click(); } });
    });

    const t = todos();
    if (estado.sec === BF) {
      $("chips").innerHTML = t.length ? `<span class="stat"><b>${t.length}</b> modelos de la Tienda a mitad de precio</span>` : "";
      const lista = productos();
      $("filas").innerHTML = !estado.datos ? vacia("Cargando…", cols.length, true)
        : !bfActivo() ? vacia(BF_TEXTO, cols.length)
        : lista.length ? lista.map(p => fila(p, cols)).join("")
        : vacia(estado.q ? "Ningún modelo coincide con la búsqueda." : "Todavía no hay modelos a mitad de precio en la Tienda.", cols.length);
    } else {
      const crit = t.filter(p => p.nivel === "crit").length, low = t.filter(p => p.nivel === "low").length;
      const dato = (n, nivel, texto) => `<span class="stat${n ? "" : " zero"}"><span class="dot ${nivel}"></span><b>${n}</b> ${texto}</span>`;
      $("chips").innerHTML = t.length ? dato(crit, "crit", "con 5 o menos") + dato(low, "low", "entre 6 y 20") : "";

      const lista = productos();
      $("filas").innerHTML = lista.length ? lista.map(p => fila(p, cols)).join("")
        : !estado.datos ? vacia("Cargando…", cols.length, true)
        : vacia(estado.q ? "Ningún modelo coincide con la búsqueda." : "No hay datos para esta sección.", cols.length);
    }
    // El ancho de las barras se aplica desde JS: la CSP no permite estilos en el HTML.
    $("filas").querySelectorAll(".meter-fill").forEach(e => {
      const pct = +e.dataset.pct;
      e.style.width = pct + "%";
      e.classList.add(pct >= 95 ? "v5" : pct >= 75 ? "v4" : pct >= 65 ? "v3" : pct >= 50 ? "v2" : "v1");
    });

    const f = fechaLocal(estado.datos?.secciones?.[seccionDatos()]?.actualizado || estado.datos?.actualizado);
    if (f) {
      const min = haceMin(f);
      $("estado").innerHTML = `Actualizado ${cuando(f)}` +
        (min >= 0 ? ` · <span class="${min > 90 ? "viejo" : ""}">${hace(min)}</span>` : "");
    }
  }

  // --- Cifrado ---
  const CLAVE_GUARDADA = "stock-otto-k";
  const utf8 = new TextEncoder();
  const deB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const aB64 = b => btoa(String.fromCharCode(...b));

  async function derivar(clave, sal, iter) {
    const base = await crypto.subtle.importKey("raw", utf8.encode(clave), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: utf8.encode(sal), iterations: iter }, base, 512);
    return new Uint8Array(bits);
  }
  async function descifrar(sobre, k) {
    const iv = deB64(sobre.iv), ct = deB64(sobre.ct), mac = deB64(sobre.mac);
    const firmado = new Uint8Array(iv.length + ct.length); firmado.set(iv); firmado.set(ct, iv.length);
    const kMac = await crypto.subtle.importKey("raw", k.slice(32), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC", kMac, mac, firmado)) throw new Error("clave");
    const kAes = await crypto.subtle.importKey("raw", k.slice(0, 32), "AES-CBC", false, ["decrypt"]);
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, kAes, ct)));
  }
  async function bajarSobre() {
    const r = await fetch("data/stock.enc.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("red");
    return r.json();
  }

  // Se guarda la clave derivada (no la contrasena), atada a la sal y las iteraciones.
  function leerGuardada() {
    for (const s of [sessionStorage, localStorage]) {
      try { const v = JSON.parse(s.getItem(CLAVE_GUARDADA)); if (v?.k) return v; } catch (e) {}
    }
    return null;
  }
  function guardar(k, sobre, recordar) {
    const v = JSON.stringify({ k: aB64(k), sal: sobre.sal, iter: sobre.iter });
    try { (recordar ? localStorage : sessionStorage).setItem(CLAVE_GUARDADA, v); } catch (e) {}
  }
  function olvidar() {
    for (const s of [sessionStorage, localStorage]) { try { s.removeItem(CLAVE_GUARDADA); } catch (e) {} }
  }

  // --- Actualizar a mano el Club o la Tienda: lanza el workflow de GitHub solo para esa seccion ---
  // El token va cifrado en accion.enc.json con la clave de la web + el PIN (lo genera cifrar-accion.ps1).
  // Una vez abierto se guarda solo en memoria hasta recargar o pulsar Salir.
  const PUBLICAR = 20, COLA = 5;    // segundos medidos que tarda GitHub en arrancar y Pages en publicar
  const NOMBRE = { Club: "el Club", Tienda: "la Tienda" };
  // Ejecuciones en las que basar la estimacion, de la mas parecida a la menos.
  const PARECIDAS = {
    Club: ["Manual · Club", "Reloj · Club"],
    Tienda: ["Manual · Tienda", "Reloj · Tienda", "Manual · Todo"],
  };
  const duracionGuardada = sec => "stock-otto-dur-" + sec.toLowerCase();   // lo que tardo de verdad la ultima vez
  let accion = null, hayAccion = false, actualizando = null, fase = "", ocultarProgreso = null;
  const espera = ms => new Promise(r => setTimeout(r, ms));

  async function comprobarAccion() {
    try { hayAccion = (await fetch("accion.enc.json", { method: "HEAD", cache: "no-store" })).ok; } catch (e) { hayAccion = false; }
    pintarBoton();
  }
  function pintarBoton() {
    const b = $("actualizar"), sec = estado.sec;
    b.hidden = !(hayAccion && NOMBRE[sec]);
    if (b.hidden) return;
    b.setAttribute("aria-label", "Actualizar " + NOMBRE[sec]);
    // Mientras se actualiza una seccion, el boton de la otra espera (GitHub las haria en cola).
    b.disabled = !!actualizando;
    b.classList.toggle("girando", actualizando === sec);
  }

  async function abrirAccion(pin) {
    const r = await fetch("accion.enc.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("red");
    const sobre = await r.json();
    const base = await crypto.subtle.importKey("raw", utf8.encode(pin), "PBKDF2", false, ["deriveBits"]);
    const sal = new Uint8Array(64 + 16); sal.set(estado.k); sal.set(deB64(sobre.sal), 64);
    const k = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: sobre.iter }, base, 512));
    return descifrar(sobre, k);   // lanza "clave" si el PIN no es correcto
  }

  async function gh(ruta, opciones = {}) {
    const r = await fetch(`https://api.github.com/repos/${accion.repo}${ruta}`, {
      ...opciones, cache: "no-store",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${accion.token}`, "X-GitHub-Api-Version": "2022-11-28",
        ...(opciones.body ? { "Content-Type": "application/json" } : {}) },
    });
    if (r.status === 401 || r.status === 403 || r.status === 404) throw new Error("permiso");
    if (!r.ok) throw new Error("github");
    return r.status === 204 ? null : r.json();
  }
  const ejecuciones = async (filtro = "") => (await gh(`/actions/workflows/${accion.workflow}/runs?per_page=10${filtro}`)).workflow_runs || [];

  // Estimacion del total: lo que tardo la ultima vez en este navegador o, si no hay,
  // la media de las ejecuciones parecidas (solo Club tarda bastante menos que la Tienda).
  async function duracionEstimada(sec) {
    try { const s = +localStorage.getItem(duracionGuardada(sec)); if (s > 10 && s < 600) return s; } catch (e) {}
    try {
      const runs = await ejecuciones("&status=success");
      const parecidas = PARECIDAS[sec].map(t => runs.filter(x => x.display_title === t)).find(l => l.length) || runs;
      const d = parecidas
        .map(x => (new Date(x.updated_at) - new Date(x.run_started_at)) / 1000).filter(s => s > 0 && s < 600);
      if (d.length) return COLA + d.reduce((a, b) => a + b, 0) / d.length + PUBLICAR;
    } catch (e) {}
    return COLA + 20 + PUBLICAR;
  }

  function mostrarProgreso(seg, total) {
    const resta = Math.ceil(total - seg);
    $("progreso").hidden = false;
    $("progreso").className = "progreso";
    $("progreso-texto").textContent = `${fase} ` + (resta > 0
      ? `quedan ~${resta >= 60 ? Math.floor(resta / 60) + " min " + dos(resta % 60) + " s" : resta + " s"}` : "un momento…");
    $("progreso-barra").style.width = Math.min(95, seg / total * 100) + "%";
  }
  function terminar(sec, ok, motivo) {
    const textos = {
      permiso: "No se ha podido actualizar: el token no es válido o ha caducado.",
      fallo: "No se ha podido actualizar: la consulta ha fallado en GitHub.",
      publicar: "Consulta hecha, pero la web aún no se ha publicado. Recarga en un minuto.",
    };
    $("progreso").hidden = false;
    $("progreso").className = "progreso " + (ok ? "ok" : "fallo");
    $("progreso-texto").textContent = ok ? `${sec} actualizad${sec === "Club" ? "o" : "a"}`
      : textos[motivo] || `No se ha podido actualizar ${NOMBRE[sec]}.`;
    $("progreso-barra").style.width = "100%";
    clearTimeout(ocultarProgreso);
    if (ok) ocultarProgreso = setTimeout(() => { $("progreso").hidden = true; }, 8000);
  }

  async function actualizar(sec) {
    actualizando = sec;
    pintarBoton();
    clearTimeout(ocultarProgreso);
    fase = "Preparando…";
    let tick = null;
    try {
      const ivAntes = (await bajarSobre()).iv;
      const total = await duracionEstimada(sec), t0 = Date.now();
      tick = setInterval(() => mostrarProgreso((Date.now() - t0) / 1000, total), 1000);
      mostrarProgreso(0, total);

      // Lanzar y localizar la ejecucion nueva (la que no estaba antes).
      const previas = new Set((await ejecuciones("&event=workflow_dispatch")).map(x => x.id));
      await gh(`/actions/workflows/${accion.workflow}/dispatches`, { method: "POST", body: JSON.stringify({ ref: accion.ref, inputs: { seccion: sec } }) });
      fase = "En cola…";
      let id = null;
      for (let i = 0; i < 20 && !id; i++) {
        await espera(3000);
        id = (await ejecuciones("&event=workflow_dispatch")).find(x => !previas.has(x.id))?.id;
      }
      if (!id) throw new Error("fallo");

      let run;
      do {
        await espera(4000);
        run = await gh(`/actions/runs/${id}`);
        fase = run.status === "completed" ? "Publicando…" : run.status === "in_progress" ? `Consultando ${NOMBRE[sec]}…` : "En cola…";
      } while (run.status !== "completed");
      if (run.conclusion !== "success") throw new Error("fallo");

      // Esperar a que GitHub Pages sirva los datos nuevos.
      for (let i = 0; i < 45; i++) {
        const sobre = await bajarSobre().catch(() => null);
        if (sobre && sobre.iv !== ivAntes) {
          try { localStorage.setItem(duracionGuardada(sec), Math.round((Date.now() - t0) / 1000)); } catch (e) {}
          estado.datos = await descifrar(sobre, estado.k); actualizando = null; pintar(); terminar(sec, true); return;
        }
        await espera(4000);
      }
      throw new Error("publicar");
    } catch (e) {
      if (e.message === "permiso") accion = null;   // token no valido: se volvera a pedir el PIN
      terminar(sec, false, e.message);
    } finally {
      clearInterval(tick);
      actualizando = null;
      pintarBoton();
    }
  }

  let secPedida = "Club";   // seccion que se actualizara al confirmar el PIN
  $("actualizar").addEventListener("click", () => {
    if (actualizando || !NOMBRE[estado.sec]) return;
    secPedida = estado.sec;
    if (accion) { actualizar(secPedida); return; }
    $("dlg-titulo").textContent = "Actualizar " + secPedida;
    $("dlg-texto").textContent = `Introduce el PIN para consultar ahora el stock ${secPedida === "Club" ? "del Club" : "de la Tienda"}.`;
    $("pin").value = ""; $("error-pin").textContent = "";
    $("dlg-pin").showModal();
  });
  $("pin-cancelar").addEventListener("click", () => $("dlg-pin").close());
  $("form-pin").addEventListener("submit", async e => {
    e.preventDefault();
    $("error-pin").textContent = ""; $("pin-ok").disabled = true; $("pin-ok").classList.add("cargando");
    try {
      accion = await abrirAccion($("pin").value);
      $("dlg-pin").close();
      actualizar(secPedida);
    } catch (err) {
      $("error-pin").textContent = err.message === "clave" ? "PIN incorrecto." : "No se ha podido comprobar el PIN.";
      $("pin").select();
      const f = $("form-pin"); f.classList.remove("agitar"); void f.offsetWidth; f.classList.add("agitar");
    } finally {
      $("pin-ok").disabled = false; $("pin-ok").classList.remove("cargando");
    }
  });

  // --- Proxima actualizacion automatica ---
  // Copia del horario del reloj externo (cron-job.org, hora de Madrid): si se cambia alli, cambiarlo aqui.
  //   dias 1-11:  Club + Tienda a las :00, :15, :30 y :45, de 9:00 a 23:45
  //   dias 12-31: solo Tienda a las 9, 12, 16 y 20 h
  //   28-30 de noviembre (Black Friday): ademas, Tienda a las :00, :15, :30 y :45, de 9:00 a 23:45
  const rango = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const RELOJ = [
    { secs: ["Club", "Tienda"], dias: rango(1, 11), horas: rango(9, 23), minutos: [0, 15, 30, 45] },
    { secs: ["Tienda"], dias: rango(12, 31), horas: [9, 12, 16, 20], minutos: [0] },
    { secs: ["Tienda"], dias: rango(28, 30), meses: [11], horas: rango(9, 23), minutos: [0, 15, 30, 45] },
  ];
  const LLEGADA = 75;   // segundos desde la hora programada hasta que la web nueva esta publicada

  // Siguiente hora programada para una seccion, en hora de Madrid (busca minuto a minuto, max. 40 dias).
  function proxima(sec, desde) {
    const t = new Date(desde); t.setSeconds(0, 0);
    for (let i = 0; i < 40 * 24 * 60; i++) {
      t.setMinutes(t.getMinutes() + 1);
      if (RELOJ.some(r => r.secs.includes(sec) && r.dias.includes(t.getDate()) && (!r.meses || r.meses.includes(t.getMonth() + 1)) &&
          r.horas.includes(t.getHours()) && r.minutos.includes(t.getMinutes()))) return t;
    }
    return null;
  }

  let siguiente = { sec: null, t: null }, esperando = false;
  function pintarSiguiente() {
    const sec = seccionDatos(), ahora = ahoraMadrid();
    // Se recalcula al cambiar de pestana o cuando ya ha pasado (y ha dado tiempo a publicar).
    if (siguiente.sec !== sec || !siguiente.t || ahora - siguiente.t > LLEGADA * 1000) {
      const antes = siguiente.sec === sec ? siguiente.t : null;
      siguiente = { sec, t: proxima(sec, ahora) };
      if (antes && !esperando) traerNuevos(sec);   // acaba de tocar: cargar los datos nuevos
    }
    const t = siguiente.t;
    // En el Black Friday, antes de que empiece ya se avisa en la lista: sin contador.
    if (!t || (estado.sec === BF && !bfActivo())) { $("siguiente").textContent = ""; return; }
    const seg = Math.round((t - ahora) / 1000);
    let txt;
    if (seg <= 0) txt = "Actualizando…";
    else if (seg < 3600) txt = `Próxima en ${Math.floor(seg / 60)}:${dos(seg % 60)}`;
    else {
      const mismoDia = t.toDateString() === ahora.toDateString();
      txt = `Próxima ${mismoDia ? "hoy" : `el ${dos(t.getDate())}/${dos(t.getMonth() + 1)}`} a las ${dos(t.getHours())}:${dos(t.getMinutes())}`;
    }
    $("siguiente").textContent = txt;
  }

  // Tras una actualizacion programada, reintenta unos minutos hasta que llegan los datos nuevos.
  async function traerNuevos(sec) {
    esperando = true;
    const antes = estado.datos?.secciones?.[sec]?.actualizado;
    try {
      for (let i = 0; i < 12 && estado.k; i++) {
        await cargar();
        if (estado.datos?.secciones?.[sec]?.actualizado !== antes) return;
        await espera(20000);
      }
    } finally { esperando = false; }
  }

  let temporizador = null, reloj = null;
  function mostrarApp(abierta) {
    $("app").hidden = !abierta; $("login").hidden = abierta;
    clearInterval(temporizador); clearInterval(reloj);
    $("siguiente").textContent = "";
    if (abierta) {
      temporizador = setInterval(cargar, 5 * 60 * 1000);   // por si se actualiza a mano desde otro sitio
      siguiente = { sec: null, t: null };
      reloj = setInterval(pintarSiguiente, 1000); pintarSiguiente();
      comprobarAccion();
    }
    else {
      estado.datos = null; estado.k = null; accion = null;
      $("progreso").hidden = true;
      for (const id of ["filas", "chips", "estado", "n-Club", "n-Tienda"]) $(id).textContent = "";
      $("clave").value = ""; $("clave").focus();
    }
  }

  async function cargar() {
    try {
      const sobre = await bajarSobre();
      estado.datos = await descifrar(sobre, estado.k);
    } catch (e) {
      // Si la clave ha cambiado en el servidor, se vuelve a pedir.
      if (e.message === "clave") { olvidar(); mostrarApp(false); $("error").textContent = "La contraseña ha cambiado."; }
      return;
    }
    pintar();
  }

  $("login").addEventListener("submit", async e => {
    e.preventDefault();
    $("error").textContent = ""; $("entrar").disabled = true; $("entrar").textContent = "Comprobando…";
    $("entrar").classList.add("cargando");
    try {
      const sobre = await bajarSobre();
      const k = await derivar($("clave").value, sobre.sal, sobre.iter);
      estado.datos = await descifrar(sobre, k);
      estado.k = k;
      guardar(k, sobre, $("recordar").checked);
      mostrarApp(true); pintar();
    } catch (err) {
      $("error").textContent = err.message === "clave" ? "Contraseña incorrecta." : "No se han podido cargar los datos.";
      $("clave").select();
      const hoja = $("login").querySelector(".sheet");
      hoja.classList.remove("agitar"); void hoja.offsetWidth; hoja.classList.add("agitar");
    } finally {
      $("entrar").disabled = false; $("entrar").textContent = "Entrar";
      $("entrar").classList.remove("cargando");
    }
  });
  $("salir").addEventListener("click", () => { olvidar(); mostrarApp(false); });

  document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => {
    const cambia = estado.sec !== b.dataset.sec;
    estado.sec = b.dataset.sec; estado.orden = null;
    try { localStorage.setItem("stock-otto-sec", estado.sec); } catch (e) {}
    pintar();
    if (cambia) { const l = $("lista"); l.classList.remove("cambio"); void l.offsetWidth; l.classList.add("cambio"); }
  }));
  $("q").addEventListener("input", e => { estado.q = e.target.value; pintar(); });

  if (!window.crypto?.subtle) {
    $("error").textContent = "Este navegador no permite descifrar los datos (hace falta https).";
    $("entrar").disabled = true;
  } else {
    const g = leerGuardada();
    if (g) {
      estado.k = deB64(g.k);
      bajarSobre().then(sobre => {
        if (sobre.sal !== g.sal || sobre.iter !== g.iter) throw new Error("clave");
        return descifrar(sobre, estado.k);
      }).then(d => { estado.datos = d; mostrarApp(true); pintar(); })
        .catch(() => { olvidar(); mostrarApp(false); });
    }
  }
})();
