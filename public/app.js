/**
 * PresupuestoIA – app.js
 * Integración completa: Firebase Firestore + Claude AI
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// FIREBASE INIT
// ═══════════════════════════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, getDocs, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseApp = initializeApp({
  apiKey: "AIzaSyArUe9NXi6YMDvFCWStzgm0Yhn_wfUbF9o",
  authDomain: "presupuesto-ia-594b9.firebaseapp.com",
  projectId: "presupuesto-ia-594b9",
  storageBucket: "presupuesto-ia-594b9.firebasestorage.app",
  messagingSenderId: "78219000130",
  appId: "1:78219000130:web:a169de0c7be56dda8870db"
});
const db = getFirestore(firebaseApp);

// ═══════════════════════════════════════════════════════════════
// PRECIOS DB (cargados desde Firestore)
// ═══════════════════════════════════════════════════════════════
let PRECIOS_DB = {};

async function loadPreciosDB() {
  const snap = await getDocs(collection(db, 'precios_construccion'));
  snap.forEach(d => { PRECIOS_DB[d.id] = d.data(); });
  console.log(`✅ ${Object.keys(PRECIOS_DB).length} precios cargados desde Firestore`);
}

function getPrecio(id, calidad) {
  const p = PRECIOS_DB[id];
  if (!p) return 0;
  const k = calidad === 'premium' ? 'premium' : calidad === 'estandar' ? 'estandar' : 'media_alta';
  return p[k] || p.media_alta || 0;
}

// ═══════════════════════════════════════════════════════════════
// CATEGORIAS Y MAPEO IDs FIRESTORE
// ═══════════════════════════════════════════════════════════════
const CATEGORIES = [
  { id: 'demolicion',   label: 'Demolición',    icon: '🔨' },
  { id: 'albanileria',  label: 'Albañilería',   icon: '🧱' },
  { id: 'electricidad', label: 'Electricidad',  icon: '⚡' },
  { id: 'fontaneria',   label: 'Fontanería',    icon: '🚿' },
  { id: 'pavimentos',   label: 'Pavimentos',    icon: '⬜' },
  { id: 'pintura',      label: 'Pintura',       icon: '🖌️' },
  { id: 'carpinteria',  label: 'Carpintería',   icon: '🪵' },
  { id: 'bano',         label: 'Baño',          icon: '🛁' },
  { id: 'cocina',       label: 'Cocina',        icon: '🍳' },
];

const CAT_MAP = {
  demolicion:   ['demolicion_general','demolicion_tabique','demolicion_pavimento','gestion_residuos'],
  albanileria:  ['albanileria_tabique','albanileria_enfoscado','albanileria_general','alicatado_pared'],
  electricidad: ['electrica_completa','electrica_cuadro','electrica_punto_luz','electrica_enchufe'],
  fontaneria:   ['fontaneria_completa','fontaneria_bano','fontaneria_cocina','fontaneria_radiador','suelo_radiante'],
  pavimentos:   ['pavimento_parquet','pavimento_parquet_macizo','pavimento_gres','pavimento_microcemento','pavimento_rodapie'],
  pintura:      ['pintura_total','pintura_esmalte'],
  carpinteria:  ['ventana_aluminio','ventana_pvc','persiana_motorizada','puerta_paso','puerta_blindada','armario_empotrado'],
  bano:         ['bano_completo','bano_ducha_italiano','bano_sanitarios','bano_mampara','bano_griferia'],
  cocina:       ['cocina_muebles','cocina_encimera_silestone','cocina_encimera_ceramica'],
};

// Estimate ranges €/m² by quality
const ESTIMATE_RANGES = {
  estandar:   { min: 350, max: 550 },
  media_alta: { min: 600, max: 900 },
  premium:    { min: 1000, max: 1500 },
};

// ═══════════════════════════════════════════════════════════════
// APP STATE
// ═══════════════════════════════════════════════════════════════
const AppState = {
  currentStep: 1,
  formData: { projectType:'', city:'', surface:'', quality:'', details:'', companyName:'', clientEmail:'', clientPhone:'' },
  lineItems: [],   // [{ id, nombre, unidad, precio, cantidad, cat }]
  budgetRef: '',
  budgetMeta: {},  // { titulo, resumen, plazo_estimado, nota_ia }
};

// ═══════════════════════════════════════════════════════════════
// STEP NAVIGATION
// ═══════════════════════════════════════════════════════════════
function setStep(n) {
  document.querySelectorAll('.step-section').forEach(s => s.classList.remove('active'));
  document.getElementById(`step${n}`).classList.add('active');
  document.querySelectorAll('.step').forEach((el, i) => {
    el.classList.remove('active','completed');
    if (i + 1 < n) el.classList.add('completed');
    else if (i + 1 === n) el.classList.add('active');
  });
  AppState.currentStep = n;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ═══════════════════════════════════════════════════════════════
// STEP 1 → STEP 2: Llamar a Claude para obtener partidas
// ═══════════════════════════════════════════════════════════════
window.goToStep1 = () => setStep(1);

window.goToStep2 = async () => {
  const tipo    = document.getElementById('projectType').value;
  const ciudad  = document.getElementById('city').value.trim();
  const m2      = document.getElementById('surface').value;
  const calidad = document.getElementById('quality').value;
  const detalles= document.getElementById('details').value.trim();
  const empresa = document.getElementById('companyName').value.trim();
  const email   = document.getElementById('clientEmail').value.trim();
  const telefono= document.getElementById('clientPhone').value.trim();

  if (!tipo || !ciudad || !m2 || !calidad) {
    showToast('⚠️ Completa los campos obligatorios: tipo de obra, ciudad, superficie y calidad.');
    return;
  }

  const ivaType = parseInt(document.getElementById('ivaType')?.value || '21');
  const numBanos = parseInt(document.getElementById('numBanos')?.value || '1');
  const numViviendas = parseInt(document.getElementById('numViviendas')?.value || '10');
  const nivelRampa = document.getElementById('nivelRampa')?.value || 'medio';
  const anioConstruccion = parseInt(document.getElementById('anioConstruccion')?.value || '2000');
  const bajantesAntiguas = anioConstruccion < 1995;
  const distribucion = document.querySelector('input[name="distribucion"]:checked')?.value || 'no';
  AppState.formData = { projectType:tipo, city:ciudad, surface:m2, quality:calidad, details:detalles, companyName:empresa, clientEmail:email, clientPhone:telefono, ivaType, numBanos, distribucion, anioConstruccion, bajantesAntiguas, numViviendas, nivelRampa, cotaCero };

  // Show loading state
  setStep(2);
  // Alert for old buildings
  if (AppState.formData.bajantesAntiguas) {
    setTimeout(() => showToast('⚠️ Edificio anterior a 1995 — se incluye partida de bajantes antiguas'), 500);
  }
  document.getElementById('lineItemsContainer').innerHTML = `
    <div style="text-align:center;padding:60px 20px">
      <div class="ai-spinner" style="margin:0 auto 16px"></div>
      <p style="color:#666;font-size:0.95rem;font-weight:500">La IA está analizando el proyecto...</p>
      <p style="color:#2d4a8a;font-size:0.82rem;margin-top:8px" id="aiStep">Consultando base de datos de precios...</p>
    </div>`;

  const steps = ['Consultando base de datos de precios...','Analizando tipo de proyecto...','Estimando cantidades...','Preparando partidas...'];
  let si = 0;
  const iv = setInterval(() => { si=(si+1)%steps.length; const el=document.getElementById('aiStep'); if(el) el.textContent=steps[si]; }, 1200);

  try {
    // Partidas fijas por tipo — elimina variabilidad de la IA
    const PARTIDAS_FIJAS = {
      // Reforma integral: sin fontaneria_completa (duplica puntos agua) ni electrica_cuadro (incluido en completa)
      reforma_integral: ['demolicion_general','gestion_residuos','albanileria_general','ayudas_albanileria','albanileria_tabique','aislamiento_trasdosado','aislamiento_acustico','suelo_flotante_acustico','falso_techo_pladur','foseado_led','electrica_completa','fontaneria_bano','fontaneria_cocina','pavimento_parquet','alicatado_pared','pintura_total','ventana_aluminio','puerta_paso','split_ac','clima_conductos','caldera_condensacion','aerotermia','suelo_radiante_agua','bano_ducha_italiano','bano_sanitarios','bano_mampara','bano_griferia','cocina_muebles','cocina_encimera_silestone','limpieza_obra','proyecto_arquitecto'],
      reforma_parcial:  ['demolicion_general','gestion_residuos','albanileria_general','electrica_completa','pavimento_parquet','pintura_total','puerta_paso','limpieza_obra'],
      // Obra nueva: sin fontaneria_completa ni electrica_cuadro por misma razón
      obra_nueva:       ['demolicion_general','gestion_residuos','albanileria_general','ayudas_albanileria','albanileria_tabique','aislamiento_trasdosado','aislamiento_acustico','suelo_flotante_acustico','falso_techo_pladur','foseado_led','electrica_completa','fontaneria_bano','fontaneria_cocina','pavimento_parquet','alicatado_pared','pintura_total','ventana_aluminio','puerta_paso','puerta_blindada','split_ac','clima_conductos','caldera_condensacion','aerotermia','suelo_radiante_agua','bano_ducha_italiano','bano_sanitarios','bano_mampara','bano_griferia','cocina_muebles','cocina_encimera_silestone','limpieza_obra','proyecto_arquitecto'],
      reforma_bano:     ['demolicion_general','gestion_residuos','albanileria_enfoscado','electrica_enchufe','fontaneria_bano','alicatado_pared','solado_ceramico_bano','bano_ducha_italiano','bano_sanitarios','bano_mampara','bano_griferia','bajantes_viejas','limpieza_obra'],
      reforma_cocina:   ['demolicion_general','gestion_residuos','albanileria_enfoscado','electrica_enchufe','electrica_punto_luz','fontaneria_cocina','alicatado_pared','solado_ceramico_cocina','cocina_muebles','cocina_encimera_silestone','bajantes_viejas','limpieza_obra'],
      // Local comercial: mantiene cuadro separado (es un concepto distinto en locales)
      local_comercial:  ['demolicion_general','gestion_residuos','albanileria_general','falso_techo_pladur','electrica_completa','electrica_cuadro','fontaneria_completa','pavimento_gres','pintura_total','ventana_aluminio','puerta_blindada','split_ac','limpieza_obra','proyecto_arquitecto'],
      oficinas:         ['demolicion_general','gestion_residuos','albanileria_tabique','falso_techo_pladur','electrica_completa','electrica_cuadro','pavimento_gres','pintura_total','split_ac','limpieza_obra','proyecto_arquitecto'],
      fachada:          ['aislamiento_sate','pintura_esmalte','ventana_aluminio','gestion_residuos','limpieza_obra','proyecto_arquitecto'],
      comunidad_vecinos: ['demolicion_general','gestion_residuos','albanileria_general','rampa_accesibilidad_cte','pasamanos_rampa_inox','electrica_completa','alumbrado_emergencia','pavimento_gres','alicatado_pared','pintura_total','puerta_blindada','control_accesos','instalacion_videoportero','buzon_comunitario','felpudo_tecnico','tablon_espejo','proteccion_ascensor','bajada_cota_cero','limpieza_obra','proyecto_arquitecto'],
      cubierta:         ['aislamiento_sate','gestion_residuos','limpieza_obra','proyecto_arquitecto'],
    };

    const m2n = parseFloat(m2);
    const numBanos = AppState.formData.numBanos || 1;
    const distribucion = AppState.formData.distribucion || 'no';
    const soladoBanoPorBano = Math.max(3.5, Math.min(7.5, m2n * 0.06));
    const soladoCocina = Math.max(5.0, Math.min(14.0, m2n * 0.09));
    const superficieParquet = Math.max(0, Math.round((m2n - (soladoBanoPorBano * numBanos) - soladoCocina) * 10) / 10);
    const m2Pared = Math.round(m2n * 2.8);
    const tabiqueriaPct = distribucion === 'si' ? 0.85 : 0.05; // 85% redistribucion completa, 5% solo rozas
    const mlEncimera = Math.max(4, Math.round(m2n * 0.07));
    const alicatadoTotal = Math.round((25 * numBanos) + (mlEncimera * 0.60)); // SOLO paredes — suelos van en solado_ceramico_bano y solado_ceramico_cocina
    const aislamientoCTE = Math.round(m2n * 0.45); // perimetro fachada interior segun aparejador

    // Cantidades calculadas matemáticamente — deterministas, sin variabilidad
    const CANTIDADES_FIJAS = {
      demolicion_general: m2n,
      gestion_residuos: 1,
      albanileria_general: m2n,
      albanileria_tabique: Math.round(m2n * tabiqueriaPct),
      albanileria_enfoscado: Math.round(m2n * 0.4),
      falso_techo_pladur: m2n,
      electrica_completa: m2n,
      electrica_cuadro: 1,
      electrica_punto_luz: Math.round(m2n * 0.6),
      electrica_enchufe: Math.round(m2n * 0.5),
      fontaneria_completa: m2n,
      fontaneria_bano: 3 * numBanos,
      fontaneria_cocina: 3,
      pavimento_parquet: superficieParquet,
      pavimento_gres: m2n,
      alicatado_pared: alicatadoTotal,
      pintura_total: m2Pared,
      ventana_aluminio: Math.max(4, Math.round(m2n * 0.12)),
      puerta_paso: Math.min(7, Math.max(3, Math.round(m2n / 15))), // cap 7 segun aparejador
      puerta_blindada: 1,
      armario_empotrado: Math.round(m2n * 0.05),
      bano_ducha_italiano: numBanos,
      bano_sanitarios: numBanos,
      bano_mampara: numBanos,
      bano_griferia: numBanos,
      aislamiento_trasdosado: aislamientoCTE,
      cocina_muebles: Math.max(4, Math.round(m2n * 0.07)),
      cocina_encimera_silestone: Math.max(3, Math.round(m2n * 0.05)),
      split_ac: Math.max(1, Math.round(m2n / 25)),
      aislamiento_sate: m2n,
      limpieza_obra: m2n,
      bajantes_viejas: 2, // estimado: 1 bajante bano + 1 bajante cocina
      rampa_accesibilidad_cte: 1, // partida alzada — 1 ud por portal
      pasamanos_rampa_inox: AppState.formData?.nivelRampa === 'bajo' ? 5.2 : AppState.formData?.nivelRampa === 'alto' ? 11.2 : 7.2, // ml x 2 lados + 1.2ml prolongaciones CTE DB-SUA
      instalacion_videoportero: 1,
      buzon_comunitario: 1,
      // Solado hibrido acotado (recomendacion aparejador v13)
      solado_ceramico_bano: Math.round(Math.max(3.5, Math.min(7.5, m2n * 0.06)) * numBanos * 10) / 10, // max(3.5, min(7.5, m2*0.06)) x banos
      solado_ceramico_cocina: Math.round(Math.max(5.0, Math.min(14.0, m2n * 0.09)) * 10) / 10, // max(5.0, min(14.0, m2*0.09))
      control_accesos: 1,
      proteccion_ascensor: 1,
      felpudo_tecnico: 1,
      control_accesos: 1,
      proteccion_ascensor: 1,
      bajada_cota_cero: 0, // partida opcional — se activa si usuario marca checkbox en formulario
      tablon_espejo: 1, // 1 ud por portal
      alumbrado_emergencia: 1, // 1 ud alzada por portal
      rampa_accesibilidad_cte: 1, // partida alzada (1 ud independiente del m²)
      instalacion_videoportero: 1, // placa fija + monitores por num_viviendas (campo adicional)
      // Climatización por calidad: split=estandar, conductos+caldera=media_alta, aerotermia=premium
      // Cantidad 1 para todos — el precio unitario refleja la calidad (0€ si no aplica a esa calidad)
      clima_conductos: Math.max(1, Math.round(m2n / 70)),
      caldera_condensacion: 1,
      aerotermia: 1, // bomba de calor (unidad fija)
      suelo_radiante_agua: m2n, // tubo PE-X + colectores + aditivos por m²
      aislamiento_cubierta: m2n,
      ayudas_albanileria: 1, // partida alzada (precio = 11% de fontaneria+electrica, calculado post)
      aislamiento_acustico: Math.round(m2n * 0.3), // medianeras: ~1 pared medianera estándar
      foseado_led: Math.round(Math.sqrt(m2n) * 3), // sqrt(m²)×3 ml — salón+dormitorio principal
      // Media-alta: solo bajo parquet. Premium: m² totales (incluye zonas húmedas con elastómero)
      suelo_flotante_acustico: calidadState === 'premium' ? m2n : superficieParquet,
      suelo_radiante_agua: m2n, // m² totales para instalación completa
      proyecto_arquitecto: 1,
    };

    const idsParaTipo = [...(PARTIDAS_FIJAS[tipo] || PARTIDAS_FIJAS['reforma_integral'])];
    // Añadir bajantes viejas si edificio anterior a 1995
    if (AppState.formData.bajantesAntiguas && ['reforma_integral','obra_nueva'].includes(tipo)) {
      if (!idsParaTipo.includes('bajantes_viejas')) idsParaTipo.push('bajantes_viejas');
    }
    
    // Construir partidas directamente sin llamar a la IA para las cantidades
    const arr = idsParaTipo
      .filter(id => PRECIOS_DB[id])
      .map(id => ({ id, cantidad: CANTIDADES_FIJAS[id] || 1 }));

    // Añadir detalles adicionales si los hay (única parte que usa IA)
    let finalArr = arr;
    if (detalles && detalles.length > 10) {
      // Solo usamos IA para interpretar detalles especiales
      try {
        const promptDetalles = `El cliente pide esto extra: "${detalles}". De estos IDs adicionales: armario_empotrado, split_ac, suelo_radiante, pavimento_microcemento, puerta_blindada, split_ac. Devuelve SOLO array JSON de los que apliquen con cantidad estimada para ${m2}m²: [{"id":"armario_empotrado","cantidad":3}] o [] si no aplica ninguno.`;
        const rd = await fetch('/api/ai', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ model:'claude-sonnet-4-5', max_tokens:200, messages:[{role:'user',content:promptDetalles}] }) });
        const dd = await rd.json();
        if (dd.content) {
          const rawD = dd.content.map(i=>i.text||'').join('').replace(/```json|```/g,'').trim();
          const jsD = rawD.indexOf('['); const jeD = rawD.lastIndexOf(']')+1;
          if (jsD >= 0) {
            const extras = JSON.parse(rawD.slice(jsD,jeD));
            const existingIds = new Set(finalArr.map(p=>p.id));
            extras.forEach(e => { if(!existingIds.has(e.id) && PRECIOS_DB[e.id]) finalArr.push(e); });
          }
        }
      } catch(e2) { /* ignore extra details error */ }
    }

    clearInterval(iv);

    // Ajuste de precio unitario según condiciones del proyecto
    const distribucionState = AppState.formData.distribucion || 'no';
    const calidadState = AppState.formData.quality || 'media-alta';

    AppState.lineItems = finalArr
      .filter(p => PRECIOS_DB[p.id])
      .map(p => {
        // Find category
        let cat = 'otros';
        for (const [catKey, ids] of Object.entries(CAT_MAP)) { if (ids.includes(p.id)) { cat = catKey; break; } }
        let precioUnitario = getPrecio(p.id, calidad);
        // Pintura más barata si no hay redistribución (sobre paramento existente)
        if (p.id === 'pintura_total' && distribucionState === 'no') {
          precioUnitario = calidadState === 'premium' ? 12 : calidadState === 'estándar' ? 6 : 9;
        }
        // Climatización: split solo para estándar, conductos+caldera para media_alta, aerotermia para premium
        // Split: solo estándar
        if (p.id === 'split_ac' && (calidadState === 'media-alta' || calidadState === 'premium')) precioUnitario = 0;
        // Conductos+caldera: solo media-alta (0 en estándar Y en premium)
        if (p.id === 'clima_conductos' && calidadState !== 'media-alta') precioUnitario = 0;
        if (p.id === 'caldera_condensacion' && calidadState !== 'media-alta') precioUnitario = 0;
        // Aerotermia+suelo radiante: solo premium
        if (p.id === 'aerotermia' && calidadState !== 'premium') precioUnitario = 0;
        if (p.id === 'suelo_radiante_agua' && calidadState !== 'premium') precioUnitario = 0;
        if (p.id === 'aislamiento_acustico' && calidadState === 'estándar') precioUnitario = 0;
        if (p.id === 'foseado_led' && calidadState === 'estándar') precioUnitario = 0;
        // Bajada cota cero: solo si usuario activa el checkbox
        if (p.id === 'bajada_cota_cero') {
          precioUnitario = AppState.formData.cotaCero === 'si' ? getPrecio(p.id, calidad) : 0;
          if (AppState.formData.cotaCero === 'si') p = {...p, cantidad: 1};
        }
        // Videoportero: precio dinamico = 850 fijo + 190 * num_viviendas
        if (p.id === 'instalacion_videoportero') {
          const nv = AppState.formData.numViviendas || 10;
          precioUnitario = 850 + (190 * nv);
        }
        // Buzon comunitario: precio dinamico = 250 fijo + 50 * num_viviendas
        if (p.id === 'buzon_comunitario') {
          const nv = AppState.formData.numViviendas || 10;
          precioUnitario = 250 + (50 * nv);
        }
        // Rampa accesibilidad: precio por desnivel (independiente de calidad estetica)
        if (p.id === 'rampa_accesibilidad_cte') {
          const nr = AppState.formData.nivelRampa || 'medio';
          precioUnitario = nr === 'bajo' ? 1400 : nr === 'alto' ? 3500 : 2200;
        }
        // Suelo flotante acustico: 0 en estandar
        if (p.id === 'suelo_flotante_acustico' && calidadState === 'estándar') precioUnitario = 0;
        if (p.id === 'aislamiento_cubierta') precioUnitario = 0;
        let nombrePartida = PRECIOS_DB[p.id].nombre;
        // Portal: cantidades correctas para paramentos verticales (perimetro x altura)
        if (AppState.formData.projectType === 'comunidad_vecinos') {
          const m2Portal = parseFloat(AppState.formData.surface) || 20;
          if (p.id === 'alicatado_pared') p = {...p, cantidad: Math.round(Math.sqrt(m2Portal) * 4 * 2.5)};
          if (p.id === 'pintura_total') p = {...p, cantidad: Math.round(Math.sqrt(m2Portal) * 4 * 2.5 + m2Portal)}; // paredes + techo
        }
        // Texto dinamico pavimento gres en portal segun calidad
        if (p.id === 'pavimento_gres' && AppState.formData.projectType === 'comunidad_vecinos') {
          nombrePartida = calidadState === 'premium'
            ? 'Pavimento piedra natural (Marmol o Granito abujardado) antideslizante CTE DB-SUA'
            : 'Gres porcelanico tecnico antideslizante Clase 3 (CTE DB-SUA)';
        }
        return { id: p.id, nombre: nombrePartida, unidad: PRECIOS_DB[p.id].unidad, precio: precioUnitario, cantidad: p.cantidad, cat };
      });

    renderLineItems();
    updateSummaryBar();

  } catch(e) {
    clearInterval(iv);
    showToast('❌ Error al generar partidas: ' + e.message);
    setStep(1);
  }
};

// ═══════════════════════════════════════════════════════════════
// RENDER LINE ITEMS (Step 2)
// ═══════════════════════════════════════════════════════════════
function renderLineItems() {
  const container = document.getElementById('lineItemsContainer');
  const byId = {};
  AppState.lineItems.forEach(p => byId[p.id] = p);
  let html = '';

  const renderedIds = new Set();
  for (const cat of CATEGORIES) {
    const items = AppState.lineItems.filter(p => p.cat === cat.id);
    if (!items.length) continue;

    html += `<div class="line-items-group">
      <div class="group-header">
        <span class="group-icon">${cat.icon}</span>
        <span class="group-label">${cat.label}</span>
      </div>
      <div class="line-items-table">
        <div class="lt-head">
          <span>Concepto</span><span>Ud.</span><span>Cantidad</span><span>€/ud</span><span>Total</span>
        </div>`;

    items.forEach(p => {
      const total = p.cantidad * p.precio;
      html += `<div class="lt-row" id="row-${p.id}">
        <span class="lt-concept">${p.nombre}</span>
        <span class="lt-unit">${p.unidad}</span>
        <span class="lt-qty"><input type="number" value="${p.cantidad}" min="0" step="0.5" onchange="updateQty('${p.id}', this.value)"></span>
        <span class="lt-price">${formatCurrency(p.precio)}</span>
        <span class="lt-total" id="tot-${p.id}">${formatCurrency(total)}</span>
      </div>`;
    });

    html += `</div></div>`;
    items.forEach(p => renderedIds.add(p.id));
  }

  // Render any items not matched to a category
  const unmatched = AppState.lineItems.filter(p => !renderedIds.has(p.id));
  if (unmatched.length) {
    html += `<div class="line-items-group">
      <div class="group-header"><span class="group-icon">📋</span><span class="group-label">Otros</span></div>
      <div class="line-items-table">
        <div class="lt-head"><span>Concepto</span><span>Ud.</span><span>Cantidad</span><span>€/ud</span><span>Total</span></div>`;
    unmatched.forEach(p => {
      const total = p.cantidad * p.precio;
      html += `<div class="lt-row" id="row-${p.id}">
        <span class="lt-concept">${p.nombre}</span>
        <span class="lt-unit">${p.unidad}</span>
        <span class="lt-qty"><input type="number" value="${p.cantidad}" min="0" step="0.5" onchange="updateQty('${p.id}', this.value)"></span>
        <span class="lt-price">${formatCurrency(p.precio)}</span>
        <span class="lt-total" id="tot-${p.id}">${formatCurrency(total)}</span>
      </div>`;
    });
    html += `</div></div>`;
  }

  container.innerHTML = html;
}

window.updateQty = (id, val) => {
  const item = AppState.lineItems.find(p => p.id === id);
  if (!item) return;
  item.cantidad = parseFloat(val) || 0;
  const total = item.cantidad * item.precio;
  const el = document.getElementById('tot-' + id);
  if (el) el.textContent = formatCurrency(total);
  const row = document.getElementById('row-' + id);
  if (row) row.style.opacity = item.cantidad === 0 ? '0.4' : '1';
  updateSummaryBar();
};

function calcSubtotal() {
  return AppState.lineItems.reduce((s, p) => s + p.cantidad * p.precio, 0);
}

function updateSummaryBar() {
  const sub = calcSubtotal();
  const ivaPct = (AppState.formData.ivaType || 21) / 100;
  const iva = sub * ivaPct;
  const lbl = document.getElementById("sb-iva-label");
  if(lbl) lbl.textContent = "IVA (" + (AppState.formData.ivaType||21) + "%)";
  document.getElementById('sb-subtotal').textContent = formatCurrency(sub);
  document.getElementById('sb-iva').textContent = formatCurrency(iva);
  document.getElementById('sb-total').textContent = formatCurrency(sub + iva);
}

// ═══════════════════════════════════════════════════════════════
// STEP 2 → STEP 3: Generar presupuesto final con Claude
// ═══════════════════════════════════════════════════════════════
window.goToStep3 = async () => {
  const lineas = AppState.lineItems.filter(p => p.cantidad > 0);
  const sub = lineas.reduce((s,p) => s + p.cantidad*p.precio, 0);
  const ivaPct = (AppState.formData.ivaType || 21) / 100;
  const iva = sub * ivaPct;
  const total = sub + iva;

  AppState.budgetRef = 'PRE-' + new Date().getFullYear() + '-' + String(Math.floor(Math.random()*9000+1000));

  setStep(3);
  // Show IVA notice only for 10% (particulares)
  setTimeout(() => {
    const ivaNotice = document.getElementById('ivaNotice');
    if(ivaNotice) ivaNotice.style.display = AppState.formData.ivaType === 10 ? 'block' : 'none';
  }, 100);
  // Fill header immediately
  document.getElementById('budgetRef').textContent = AppState.budgetRef;
  document.getElementById('budgetClient').textContent = AppState.formData.companyName || 'Cliente';
  document.getElementById('budgetCity').textContent = AppState.formData.city;
  document.getElementById('budgetSurface').textContent = AppState.formData.surface + ' m²';
  document.getElementById('budgetDate').textContent = formatDate(new Date());
  document.getElementById('budgetTotalPreview').textContent = formatCurrency(total);
  document.getElementById('finalSurface').textContent = AppState.formData.surface + ' m²';
  document.getElementById('final-subtotal').textContent = formatCurrency(sub);
  // Desglose Obra vs Equipamiento (cocina_muebles + cocina_encimera + proyecto_arquitecto)
  const lineasEquip = lineas.filter(l => ['cocina_muebles','cocina_encimera_silestone','proyecto_arquitecto'].includes(l.id));
  const costoEquip = lineasEquip.reduce((s,l) => s + l.total, 0);
  const costoObra = sub - costoEquip;
  const desgloEl = document.getElementById('desglose-obra-equip');
  if(desgloEl) {
    desgloEl.style.display = costoEquip > 0 ? 'block' : 'none';
    desgloEl.innerHTML = '<strong>Desglose orientativo:</strong><br>Coste de ejecución de obra: <strong>' + formatCurrency(costoObra) + '</strong><br>Equipamiento y licencias: <strong>' + formatCurrency(costoEquip) + '</strong>';
  }
  const ivaPctLabel = AppState.formData.ivaType || 21;
  document.getElementById('final-iva').textContent = formatCurrency(iva);
  // Update IVA label if element exists
  const ivaLabel = document.getElementById('final-iva-label');
  if(ivaLabel) ivaLabel.textContent = 'IVA (' + ivaPctLabel + '%)';
  document.getElementById('final-total').textContent = formatCurrency(total);

  // Render final items table
  renderFinalItems(lineas);

  // Get AI meta + analysis
  try {
    const numRef = AppState.budgetRef;
    const tipo = getProjectTypeLabel(AppState.formData.projectType);
    const prompt = `Responde SOLO con este JSON rellenando los valores, sin texto extra:
{"titulo":"TITULO","resumen":"RESUMEN","plazo_estimado":"PLAZO","nota_ia":"NOTA"}
Datos: ${tipo}, ${AppState.formData.surface}m², ${AppState.formData.city}, calidad ${AppState.formData.quality}, total ${formatCurrency(total)}.
TITULO: nombre profesional corto. RESUMEN: 1 frase. PLAZO: X-Y semanas. NOTA: 2-3 frases análisis para constructora.`;

    const r = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model:'claude-sonnet-4-5', max_tokens:400, messages:[{ role:'user', content:prompt }] })
    });
    const data = await r.json();
    if (!data.type || data.type !== 'error') {
      const raw = data.content.map(i=>i.text||'').join('').replace(/```json|```/g,'').trim();
      const js = raw.indexOf('{'); const je = raw.lastIndexOf('}')+1;
      const meta = JSON.parse(raw.slice(js,je));
      AppState.budgetMeta = meta;
      document.getElementById('budgetTitle').textContent = meta.titulo || tipo;
      document.getElementById('plazoEstimado').textContent = meta.plazo_estimado || '—';
      document.getElementById('aiLoading').style.display = 'none';
      document.getElementById('aiResult').style.display = 'block';
      document.getElementById('aiResult').innerHTML = `
        <p>${meta.nota_ia}</p>
        <div class="ai-highlight">💡 Coste por m²: <strong>${formatCurrency(Math.round(sub / (parseFloat(AppState.formData.surface)||1)))}/m²</strong> — dentro del rango habitual para calidad ${AppState.formData.quality} en España.</div>
        <p>Validez: <strong>30 días</strong> desde la fecha de emisión.</p>`;
    }
  } catch(e) {
    document.getElementById('aiLoading').style.display = 'none';
    document.getElementById('aiResult').style.display = 'block';
    document.getElementById('aiResult').innerHTML = `<p>Análisis no disponible temporalmente.</p>`;
  }

  // Save to Firestore
  try {
    await addDoc(collection(db, 'presupuestos'), {
      ref: AppState.budgetRef,
      cliente: AppState.formData.companyName,
      email: AppState.formData.clientEmail,
      tipo: AppState.formData.projectType,
      ciudad: AppState.formData.city,
      m2: AppState.formData.surface,
      calidad: AppState.formData.quality,
      total: sub + iva,
      subtotal: sub,
      fecha: serverTimestamp(),
    });
  } catch(e) { console.warn('No se pudo guardar en Firestore:', e.message); }
};

function renderFinalItems(lineas) {
  const container = document.getElementById('finalItemsContainer');
  let html = `<table class="final-table">
    <thead><tr><th>Concepto</th><th>Cant.</th><th>€/ud</th><th>Total</th></tr></thead><tbody>`;

  const renderedFinal = new Set();
  for (const cat of CATEGORIES) {
    const items = lineas.filter(p => p.cat === cat.id);
    if (!items.length) continue;
    html += `<tr class="final-cat-row"><td colspan="4">${cat.icon} ${cat.label}</td></tr>`;
    items.forEach(p => {
      renderedFinal.add(p.id);
      html += `<tr>
        <td>${p.nombre}<br><small style="color:#999">${p.cantidad} ${p.unidad}</small></td>
        <td style="text-align:right;color:#666">${p.cantidad}</td>
        <td style="text-align:right;color:#666">${formatCurrency(p.precio)}</td>
        <td style="text-align:right;font-weight:600">${formatCurrency(p.cantidad*p.precio)}</td>
      </tr>`;
    });
  }

  // Unmatched items
  lineas.filter(p => !renderedFinal.has(p.id)).forEach(p => {
    html += `<tr>
      <td>${p.nombre}<br><small style="color:#999">${p.cantidad} ${p.unidad}</small></td>
      <td style="text-align:right;color:#666">${p.cantidad}</td>
      <td style="text-align:right;color:#666">${formatCurrency(p.precio)}</td>
      <td style="text-align:right;font-weight:600">${formatCurrency(p.cantidad*p.precio)}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════
// ACTION BUTTONS
// ═══════════════════════════════════════════════════════════════
window.downloadPDF = () => window.print();

window.sendByEmail = () => {
  const email = AppState.formData.clientEmail;
  if (email) showToast(`📧 En producción: envío a ${email} via SendGrid`);
  else showToast('📧 Introduce un email en los datos del cliente');
};

window.newBudget = () => {
  AppState.lineItems = [];
  AppState.formData = { projectType:'',city:'',surface:'',quality:'',details:'',companyName:'',clientEmail:'',clientPhone:'' };
  AppState.budgetMeta = {};
  document.getElementById('aiLoading').style.display = 'flex';
  document.getElementById('aiResult').style.display = 'none';
  setStep(1);
};

// ═══════════════════════════════════════════════════════════════
// ESTIMATE PREVIEW (Step 1)
// ═══════════════════════════════════════════════════════════════
function updateEstimatePreview() {
  const surface = parseFloat(document.getElementById('surface').value) || 0;
  const quality = document.getElementById('quality').value;
  const estimateEl = document.getElementById('estimatePreview');
  const rangeEl = document.getElementById('estimateRange');
  if (surface > 0 && quality && ESTIMATE_RANGES[quality]) {
    const range = ESTIMATE_RANGES[quality];
    rangeEl.textContent = `${formatCurrency(surface * range.min)} – ${formatCurrency(surface * range.max)}`;
    estimateEl.style.display = 'block';
  } else {
    estimateEl.style.display = 'none';
  }
}

function updateQualityBadge(val) {
  const preview = document.getElementById('qualityPreview');
  const badge = document.getElementById('qualityBadge');
  if (!val) { preview.style.display = 'none'; return; }
  const labels = { estandar:'⚙️ Calidad Estándar', media_alta:'✨ Calidad Media-alta', premium:'💎 Calidad Premium' };
  badge.textContent = labels[val] || '';
  badge.className = `quality-badge quality-${val}`;
  preview.style.display = 'block';
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════
function formatCurrency(n) {
  return new Intl.NumberFormat('es-ES', { style:'currency', currency:'EUR', minimumFractionDigits:2 }).format(n);
}

function formatDate(d) {
  return new Intl.DateTimeFormat('es-ES', { day:'2-digit', month:'long', year:'numeric' }).format(d);
}

function getProjectTypeLabel(type) {
  const labels = {
    reforma_integral:'Reforma integral de vivienda', reforma_parcial:'Reforma parcial',
    obra_nueva:'Obra nueva', reforma_bano:'Reforma de baño', reforma_cocina:'Reforma de cocina',
    local_comercial:'Local comercial', oficinas:'Oficinas', fachada:'Rehabilitación de fachada', cubierta:'Reforma de cubierta', comunidad_vecinos:'Reforma portal / Comunidad vecinos',
  };
  return labels[type] || type;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  toast.style.display = 'flex';
  toast.classList.add('show');
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => { toast.style.display = 'none'; }, 300); }, 3200);
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  await loadPreciosDB();

  // Show/hide fields and warnings based on project type
  document.getElementById('projectType').addEventListener('change', function() {
    const tipo = this.value;
    const needsBanos = ['reforma_integral','obra_nueva'].includes(tipo);
    const needsDist  = ['reforma_integral','obra_nueva'].includes(tipo);
    document.getElementById('numBanosField').style.display = needsBanos ? 'block' : 'none';
    document.getElementById('distribucionField').style.display = needsDist ? 'block' : 'none';
    // Warnings
    const obraWarn = document.getElementById('obraNewaWarning');
    const comInfo = document.getElementById('comunidadInfo');
    if(obraWarn) obraWarn.style.display = tipo === 'obra_nueva' ? 'block' : 'none';
    if(comInfo) comInfo.style.display = tipo === 'comunidad_vecinos' ? 'block' : 'none';
    // Num viviendas field only for comunidad
    const numVivField = document.getElementById('numViviendasField');
    if(numVivField) numVivField.style.display = tipo === 'comunidad_vecinos' ? 'block' : 'none';
    const nivelRampaField = document.getElementById('nivelRampaField');
    if(nivelRampaField) nivelRampaField.style.display = tipo === 'comunidad_vecinos' ? 'block' : 'none';
    const cotaCeroField = document.getElementById('cotaCeroField');
    if(cotaCeroField) cotaCeroField.style.display = tipo === 'comunidad_vecinos' ? 'block' : 'none';
    const comCampos = document.getElementById('comunidadCampos');
    if(comCampos) comCampos.style.display = tipo === 'comunidad_vecinos' ? 'block' : 'none';
    // IVA auto para comunidad
    const ivaSelect = document.getElementById('ivaType');
    if(ivaSelect && tipo === 'comunidad_vecinos') ivaSelect.value = '10';
    else if(ivaSelect && tipo !== 'comunidad_vecinos') ivaSelect.value = '21';
  });

  document.getElementById('quality').addEventListener('change', function() {
    updateQualityBadge(this.value);
    updateEstimatePreview();
  });
  document.getElementById('surface').addEventListener('input', updateEstimatePreview);

  ['projectType','city','surface','quality','companyName','clientEmail','clientPhone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if(e.key==='Enter') goToStep2(); });
  });

  document.getElementById('newBudgetBtn').addEventListener('click', () => {
    if (AppState.currentStep > 1) {
      if (confirm('¿Crear nuevo presupuesto? Se perderán los datos actuales.')) newBudget();
    } else newBudget();
  });

  document.querySelector('.logo').addEventListener('click', () => {
    if (AppState.currentStep > 1) {
      if (confirm('¿Volver al inicio?')) newBudget();
    }
  });
});
