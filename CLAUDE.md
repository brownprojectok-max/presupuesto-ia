# PresupuestoIA — CLAUDE.md

Guía de contexto completo para trabajar en este repositorio de forma autónoma.
Léela entera antes de tocar cualquier archivo.

---

## Identidad del proyecto

App web SaaS para constructoras españolas que genera presupuestos de obra automáticamente.
Motor de cálculo 100% determinista (sin IA en el cálculo base). Claude API solo para análisis y metadatos del presupuesto final.

- **Live:** https://presupuesto-ia-psi.vercel.app
- **Repo:** https://github.com/brownprojectok-max/presupuesto-ia
- **Firebase:** presupuesto-ia-594b9
- **Stack:** HTML/CSS/JS vanilla + Vercel Serverless + Firebase Firestore + Anthropic API (Claude Sonnet)
- **Versión actual:** v19 (aprobada para producción comercial)

---

## Estructura del repositorio

```
presupuesto-ia/
├── public/
│   ├── index.html       # UI completa — 3 pasos, stepper, formulario
│   ├── app.js           # Motor de cálculo + Firebase + lógica UI
│   └── styles.css       # Estilos completos
├── api/
│   └── ai.js            # Proxy Vercel → Anthropic API (serverless function)
├── admin/
│   └── update_proyecto_arquitecto.html  # Herramienta admin Firestore (NO sirve Vercel — abrir local)
├── public/
│   └── update_proyecto_arquitecto.html  # Misma herramienta pero accesible desde Vercel
├── CLAUDE.md            # Este archivo
└── vercel.json          # Config Vercel (vacío — usa defaults)
```

---

## Flujo de la aplicación (3 pasos)

```
Paso 1: Formulario
  → tipo_proyecto, ciudad, superficie, calidad, num_baños,
    año_construccion, tiene_gotele, cambio_distribucion,
    tipoConstruccion (obra_nueva), nivel_rampa / num_viviendas (comunidad),
    IVA (10% particular / 21% empresa)

Paso 2: Confirmar partidas
  → Motor genera array de partidas deterministas
  → Usuario puede editar cantidades
  → Summary bar actualiza en tiempo real

Paso 3: Presupuesto final
  → Claude API genera titulo, resumen, plazo_estimado, nota_ia (JSON)
  → Se guarda en Firestore colección 'presupuestos'
  → PDF via window.print()
```

---

## Motor de cálculo — reglas críticas

### Las partidas NO las genera la IA
`PARTIDAS_FIJAS` es un objeto JS con arrays de IDs por tipo de obra.
`CANTIDADES_FIJAS` calcula cada cantidad matemáticamente.
La IA solo interviene en: (1) interpretar campo `detalles` para añadir extras, (2) generar metadatos del paso 3.

### Tipos de obra y sus partidas
- `reforma_integral` — 34 partidas + bajantes si año < 1995
- `reforma_parcial` — 8 partidas
- `obra_nueva` — 35 partidas
- `reforma_bano` — 11 partidas
- `reforma_cocina` — 10 partidas
- `local_comercial` — 13 partidas
- `oficinas` — 10 partidas
- `fachada` — 5 partidas
- `comunidad_vecinos` — 21 partidas (IVA 10% auto)
- `cubierta` — 4 partidas

### Fórmulas de cantidad exactas (app.js)

```js
soladoBañoPorBaño  = Math.max(3.5, Math.min(7.5, m2n * 0.06))
soladoCocina       = Math.max(5.0, Math.min(14.0, m2n * 0.09))
superficieParquet  = Math.max(0, Math.round((m2n - (soladoBañoPorBaño * numBaños) - soladoCocina) * 10) / 10)
mlEncimera         = Math.max(4, Math.min(7, Math.round(m2n * 0.07)))
alicatadoTotal     = Math.round((25 * numBaños) + (mlEncimera * 0.60))
cocina_muebles     = Math.max(4, Math.min(7, Math.round(m2n * 0.07)))
cocina_encimera    = Math.max(4, Math.min(7, Math.round(m2n * 0.07)))  // min=4 igual que muebles [v18]
puerta_paso        = Math.min(15, Math.max(3, Math.round(m2n / 15)))
pintura_cantidad   = Math.round(m2n * 2.8)
ventanas           = Math.max(4, Math.round(m2n * 0.12))
foseado_led        = Math.round(Math.sqrt(m2n) * 3)
aislamiento_acust  = Math.round(m2n * 0.30)
aislamiento_term   = Math.round(m2n * 0.45)
split_ac           = Math.max(1, Math.round(m2n / 25))
clima_conductos    = Math.max(1, Math.round(m2n / 70))
```

### Lógica condicional crítica

**Pintura (mutuamente excluyente):**
```js
if (gotelé && redistrib)  → Math.max(38, base * 1.25 + 12)
if (gotelé && !redistrib) → Math.max(35, base + 12)
if (!gotelé && redistrib) → base * 1.25
else                      → base
```

**Climatización — MUTEX por calidad [FIX v19 — string es media_alta con guión bajo]:**
```js
'estandar'   → split ACTIVO    | conductos/caldera/aerotermia = 0€
'media_alta' → split = 0€      | conductos + caldera ACTIVOS  | aerotermia = 0€
'premium'    → split/conductos/caldera = 0€ | aerotermia + suelo_radiante ACTIVOS
```
⚠️ CRÍTICO: el value del `<select>` HTML usa guión bajo (`media_alta`), no guión medio.
Si comparas con `'media-alta'` el mutex no funciona. Siempre usar `'media_alta'`.

**Bajantes antiguas:**
```js
if (añoConstruccion < 1995 && ['reforma_integral','obra_nueva'].includes(tipo))
  → añadir bajantes_viejas (2 ud) al array de partidas
```

**Aislamiento acústico:**
```js
if (calidad === 'estandar') → 0€
if (tipo === 'obra_nueva' && tipoConstruccion === 'aislado') → 0€
// adosado/pareado → precio normal (CTE DB-HR)
```

**Partidas con precio dinámico (no vienen de Firestore):**
```js
videoportero  = 850 + (190 * numViviendas)
buzon         = 250 + (50 * numViviendas)
rampa         = nivelRampa === 'bajo' ? 1400 : nivelRampa === 'alto' ? 3500 : 2200
pasamanos     = nivelRampa === 'bajo' ? 5.2 : nivelRampa === 'alto' ? 11.2 : 7.2  // ml
bajada_cota_cero → solo si checkbox=SÍ
```

---

## Firebase Firestore

**Proyecto:** presupuesto-ia-594b9
**Colección principal:** `precios_construccion`

Estructura de cada documento:
```json
{
  "nombre": "string",
  "unidad": "m² | ud | ml | ...",
  "estandar": 0,
  "media_alta": 0,
  "premium": 0,
  "descripcion": "string"
}
```

**Colección secundaria:** `presupuestos` (presupuestos generados por usuarios)

### Documento especial: `proyecto_arquitecto`
- `estandar`: 3000
- `media_alta`: 7500 (validado aparejador + Gemini v18)
- `premium`: 9500
- `descripcion`: texto contractual con 6 exclusiones explícitas (ver descripción completa en Firestore)

### Actualizar Firestore
Usar las herramientas HTML en `public/update_proyecto_arquitecto.html`.
Abrirlas en Chrome desde Vercel (o localmente desde `admin/`).
NUNCA editar Firestore directamente sin herramienta de verificación post-escritura.

---

## API Proxy (api/ai.js)

Vercel serverless function que:
1. Lee precios de Firestore y los inyecta en el prompt
2. Reenvía a `api.anthropic.com/v1/messages`
3. Usa `process.env.ANTHROPIC_API_KEY` (variable de entorno en Vercel)

Modelo: `claude-sonnet-4-5` (no cambiar sin testear)

Claude API se usa para DOS cosas únicamente:
- **Detalles adicionales:** interpretar texto libre del usuario → partidas extra
- **Metadatos paso 3:** `{titulo, resumen, plazo_estimado, nota_ia}` en JSON estricto

---

## Header y navegación

- **"Mis Presupuestos" y "Clientes":** eliminados permanentemente [b7d043d]
- **"+ Nuevo presupuesto":** solo visible en paso 2 y 3 (`display:none` en paso 1)
- Al pulsar "Nuevo presupuesto": resetea AppState + limpia todos los campos + vuelve a paso 1

---

## IVA

- **21%** — empresas/sociedades (default)
- **10%** — particulares vivienda habitual / comunidades de vecinos (auto)
- Aviso legal completo sobre condiciones del 10% en paso 3

---

## Convenciones de trabajo

### Antes de cualquier cambio
1. `git pull origin master` para tener el código más reciente
2. Leer las líneas afectadas antes de editar
3. Verificar con `grep -n` que el string a reemplazar existe exactamente una vez

### Commits
Formato: `tipo: descripción corta`
- `fix:` — corrección de bug
- `feat:` — nueva funcionalidad
- `fix vXX:` — corrección de versión específica (ej. `fix v19:`)

### Push
Usar el token de GitHub configurado en el remote:
```bash
git add <archivos>
git commit -m "tipo: descripción"
git push origin master
```
Vercel despliega automáticamente en ~1 minuto tras el push.

### Firestore
Cambios de precios o descripciones → generar herramienta HTML, NO editar directamente.
Siempre hacer `getDoc` de verificación post-escritura.

---

## Informes de auditoría

**Formato:** SIEMPRE PDF (nunca DOCX)
**Librería:** `reportlab` (Python)
**Estructura canónica:**
- Banner instrucciones (amarillo)
- Banner correcciones de versión (verde)
- Sección A: Partidas visibles con fórmulas
- Sección B: Fórmulas JavaScript exactas
- Sección C: Lógica condicional completa
- Sección D: Casos extremos (30 / 75 / 200 m²)
- Tabla de validación final con preguntas para el revisor

**Referencia:** `partidas-presupuestoia-v17.docx` (formato canónico original en DOCX)

---

## Historial de versiones relevante

| Versión | Cambio principal |
|---------|-----------------|
| v17 | silestone cap 7ml · aislamiento acústico condicional · pintura gotelé sin redundancia · puertas cap 15 · proyecto_arquitecto 6.000€ |
| v18 | silestone min=4 igual que muebles · proyecto_arquitecto 7.500€ · texto contractual 5 exclusiones |
| v18 Final | 6ª exclusión contractual (refuerzo estructural/patologías ocultas) · aprobado despliegue comercial |
| v19 | FIX CRÍTICO mutex climatización: `'media-alta'` → `'media_alta'` (guión bajo = value del select HTML) · commit 6b72804 |

---

## Estado actual (Mayo 2026)

| Componente | Estado |
|---|---|
| Motor de cálculo 34 partidas | ✅ Producción |
| Base de datos Firestore v19 | ✅ Validada aparejador colegiado + Gemini |
| Mutex climatización | ✅ Corregido v19 |
| Texto contractual proyecto_arquitecto | ✅ 6 exclusiones en Firestore |
| UI 3 pasos | ✅ Funcional |
| Header limpio | ✅ Sin secciones inactivas |
| Test case real 87m² | ✅ 123.470€ — aprobado |
| Email (SendGrid) | 🔲 Pendiente integración |
| Auth / login usuarios | 🔲 No implementado |
| Panel de administración | 🔲 No implementado |

---

*PresupuestoIA · presupuesto-ia-psi.vercel.app · v19 · Mayo 2026*
