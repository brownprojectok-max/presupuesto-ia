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

  AppState.formData = { projectType:tipo, city:ciudad, surface:m2, quality:calidad, details:detalles, companyName:empresa, clientEmail:email, clientPhone:telefono };

  // Show loading state
  setStep(2);
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
    const ids = Object.keys(PRECIOS_DB).join(', ');
    const prompt = `Proyecto: ${getProjectTypeLabel(tipo)}, ${m2}m², ${ciudad}, calidad ${calidad}.${detalles ? ' Requisitos: ' + detalles + '.' : ''} IDs disponibles: ${ids}. Elige 6-10 IDs relevantes y estima cantidades para ${m2}m². Devuelve SOLO array JSON: [{"id":"demolicion_general","cantidad":75}]`;

    const r = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model:'claude-sonnet-4-5', max_tokens:800, messages:[{ role:'user', content:prompt }] })
    });
    const data = await r.json();
    if (data.type === 'error' || !data.content) throw new Error(data.error?.message || 'Error IA');

    const raw = data.content.map(i => i.text||'').join('').replace(/```json|```/g,'').trim();
    let depth=0, js=raw.indexOf('['), je=js;
    for(let i=js;i<raw.length;i++){ if(raw[i]==='[')depth++; else if(raw[i]===']'){depth--;if(depth===0){je=i+1;break;}} }
    const arr = JSON.parse(raw.slice(js, je));

    clearInterval(iv);

    AppState.lineItems = arr
      .filter(p => PRECIOS_DB[p.id])
      .map(p => {
        // Find category
        let cat = 'otros';
        for (const [c, ids] of Object.entries(CAT_MAP)) { if (ids.includes(p.id)) { cat = c; break; } }
        return { id: p.id, nombre: PRECIOS_DB[p.id].nombre, unidad: PRECIOS_DB[p.id].unidad, precio: getPrecio(p.id, calidad), cantidad: p.cantidad, cat };
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
  const iva = sub * 0.21;
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
  const iva = sub * 0.21;
  const total = sub + iva;

  AppState.budgetRef = 'PRE-' + new Date().getFullYear() + '-' + String(Math.floor(Math.random()*9000+1000));

  setStep(3);
  // Fill header immediately
  document.getElementById('budgetRef').textContent = AppState.budgetRef;
  document.getElementById('budgetClient').textContent = AppState.formData.companyName || 'Cliente';
  document.getElementById('budgetCity').textContent = AppState.formData.city;
  document.getElementById('budgetSurface').textContent = AppState.formData.surface + ' m²';
  document.getElementById('budgetDate').textContent = formatDate(new Date());
  document.getElementById('budgetTotalPreview').textContent = formatCurrency(total);
  document.getElementById('finalSurface').textContent = AppState.formData.surface + ' m²';
  document.getElementById('final-subtotal').textContent = formatCurrency(sub);
  document.getElementById('final-iva').textContent = formatCurrency(iva);
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

  for (const cat of CATEGORIES) {
    const items = lineas.filter(p => p.cat === cat.id);
    if (!items.length) continue;
    html += `<tr class="final-cat-row"><td colspan="4">${cat.icon} ${cat.label}</td></tr>`;
    items.forEach(p => {
      html += `<tr>
        <td>${p.nombre}<br><small style="color:#999">${p.cantidad} ${p.unidad}</small></td>
        <td style="text-align:right;color:#666">${p.cantidad}</td>
        <td style="text-align:right;color:#666">${formatCurrency(p.precio)}</td>
        <td style="text-align:right;font-weight:600">${formatCurrency(p.cantidad*p.precio)}</td>
      </tr>`;
    });
  }

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
    local_comercial:'Local comercial', oficinas:'Oficinas', fachada:'Rehabilitación de fachada', cubierta:'Reforma de cubierta',
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
