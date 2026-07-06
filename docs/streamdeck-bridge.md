# Stream Deck Bridge — Corsair Galleon 100 SD ↔ Admira XP

> Handoff de Claude → Codex.
> Estado: v26.05.11.2 (bridge silencioso cargado en `game.html`, pagina `admira-events` con 12 acciones).
> Tu job: poner las 12 acciones en las teclas del Galleon y disparar la accion correspondiente cuando el usuario las pulse.

---

## TL;DR (que tienes que hacer)

1. **Lee el manifest** desde una de estas dos fuentes:
   - **HTTP estatico (preferido):** `GET https://csilvasantin.github.io/01.-AdmiraXperience-Game/streamdeck-manifest.json`
   - **In-browser (si tu daemon corre dentro del navegador):** `window.AdmiraXP_StreamDeck.manifest()`
2. **Pinta los 12 botones** en el LCD del Galleon usando `icon` + `label_es` (o `label_en` segun `lang`) + `color`.
3. **Cuando el usuario pulse una tecla**, dispara el comando correspondiente. Tres caminos posibles (elige uno segun donde corra tu daemon):
   - **A** `postMessage` al tab del juego.
   - **B** Llamada JS directa si compartes contexto.
   - **C** HTTP local (necesita extender `elgato-proxy.js` — ver seccion 5; pidemelo y te lo monto).
4. **Captura del LCD principal** del Galleon (si quieres replicar el canvas central del juego en la pantalla grande del teclado): la URL `?streamdeck=mirror` muestra solo `<canvas>` a viewport completo, sin chrome.

---

## 1. Manifest schema

Devuelto por `window.AdmiraXP_StreamDeck.manifest()` o el JSON estatico equivalente:

```json
{
  "version": "1.0.0",
  "generatedAt": "2026-05-11T14:00:00.000Z",
  "pages": [
    {
      "id": "admira-events",
      "name": "Admira Events",
      "nameEn": "Admira Events",
      "accent": "#ffd866",
      "description": "Eventos rápidos del Xtanco: NPCs, tienda, ambiente y feeds.",
      "descriptionEn": "Quick Xtanco events: NPCs, store, ambient and feeds.",
      "buttons": [
        {
          "index": 0,
          "id": "thief",
          "label_es": "LADRÓN",
          "label_en": "THIEF",
          "icon": "🚨",
          "color": "#ff5544",
          "cmd": "/ladron"
        }
      ]
    }
  ]
}
```

| Campo button | Tipo | Uso en el Galleon |
|---|---|---|
| `index` | int (0-11) | Posicion fisica en el grid 6×2 |
| `id` | string | Identificador estable, usalo para `press()` |
| `label_es` / `label_en` | string | Texto que pintas en la tecla |
| `icon` | string emoji | Glyph del icono (renderiza como imagen ≥48px) |
| `color` | hex | Tinta de fondo de la tecla |
| `cmd` | string | Comando que dispara el dispatcher cuando se pulsa (no lo necesitas pintar) |

---

## 2. Los 12 botones de la pagina `admira-events`

| # | Icono | Label ES | Label EN | Color | Comando |
|---|---|---|---|---|---|
| 0 | 🚨 | LADRÓN | THIEF | #ff5544 | `/ladron` |
| 1 | 🚓 | GUARDIA CIVIL | GUARDIA CIVIL | #4488ff | `/gc` |
| 2 | 💬 | OPINADOR | REVIEWER | #ffcc44 | `/opinador` |
| 3 | ⚠️ | DEVOLUCIÓN | RETURN | #ff8844 | `/devolucion` |
| 4 | 🎩 | PEDIDO ESPECIAL | SPECIAL ORDER | #cc99ff | `/pedido` |
| 5 | 🎟️ | LLAMAR TURNO | NEXT TICKET | #44ddff | `/turno` |
| 6 | 🎵 | DJ NOVAH | DJ NOVAH | #ff66cc | `/dj on` |
| 7 | 🤖 | UNITREE BOT | UNITREE BOT | #88ee44 | `/robot on` |
| 8 | 🗺️ | HEATMAP | HEATMAP | #aa66ff | `/heatmap` |
| 9 | 🔊 | AMBIENTE | AMBIENT | #999999 | `/ambiente` |
| 10 | 📺 | PIXER FEED | PIXER FEED | #ee44cc | `/pixeria on` |
| 11 | 📊 | ESTADO | STATUS | #dddddd | `/status` |

Layout sugerido en el Galleon (6 columnas × 2 filas):

```
[ 0 ] [ 1 ] [ 2 ] [ 3 ] [ 4 ] [ 5 ]
[ 6 ] [ 7 ] [ 8 ] [ 9 ] [10 ] [11 ]
```

---

## 3. Tres caminos para disparar la accion

### A. `postMessage` (recomendado si tu daemon abre el juego en un tab/iframe)

```js
// Desde el daemon
const gameWin = window.open('https://csilvasantin.github.io/01.-AdmiraXperience-Game/game.html', 'admiraxp');

function pressKey(btnIdx){
  gameWin.postMessage({
    type: 'admiraxp-sd-press',
    pageId: 'admira-events',
    btnIdx,
    requestId: crypto.randomUUID(),
  }, '*');
}

window.addEventListener('message', (ev) => {
  if(ev.data && ev.data.type === 'admiraxp-sd-press-result'){
    console.log('press result:', ev.data); // { ok, button, result, requestId }
  }
});
```

Tambien soporta `{ type: 'admiraxp-sd-manifest' }` para refrescar el catalogo sin recargar.

### B. JS directo (si tu daemon vive en el mismo contexto: extension, userscript, devtools)

```js
const result = await window.AdmiraXP_StreamDeck.press('admira-events', 0);
// → { ok:true, button:{...}, result:'🚨 Ladrón entrando por la puerta...' }
```

O por id de boton (mas estable si reordenamos):

```js
await window.AdmiraXP_StreamDeck.press('admira-events', 'thief');
```

### C. HTTP local (si tu daemon es nativo y no comparte contexto con el navegador)

**Cableado en `elgato-proxy.js` + `game.html`.** Flujo:

- `GET  http://localhost:9126/sd/manifest` -> devuelve `{ok:true, manifest}`.
- `POST http://localhost:9126/sd/press` con body `{pageId, btnIdx, requestId?}` -> encola un press validado contra el manifest.
- `GET  http://localhost:9126/sd/pending` -> la pestana del juego consume el siguiente item.
- `POST http://localhost:9126/sd/result` -> la pestana publica el resultado del comando.
- `GET  http://localhost:9126/sd/result?requestId=...` -> el daemon puede leer el resultado si necesita feedback.

El `game.html` hace polling suave a `/sd/pending` cuando detecta el bridge cargado. En localhost usa `location.origin`; desde GitHub Pages usa `XTANCO_RUNTIME_CONFIG.tube.proxyUrl`.

Ejemplo:

```bash
curl -X POST http://localhost:9126/sd/press \
  -H 'Content-Type: application/json' \
  -d '{"pageId":"admira-events","btnIdx":0}'
```

---

## 4. Captura del canvas para el LCD principal del Galleon

Si quieres que el LCD grande del teclado muestre la "zona central" del juego (estanco isometrico, NPCs, etc):

- URL: `https://csilvasantin.github.io/01.-AdmiraXperience-Game/game.html?streamdeck=mirror`
- Renderiza unicamente `<canvas>` a 100vw × 100vh, fondo negro, sin HUD ni paneles.
- Captura por desktop-grab de la ventana → push al LCD.

Tamaño nativo del canvas: 800×500. Mantiene aspect ratio (`object-fit: contain`).

---

## 5. Re-cargas y refresco

El manifest es estatico para la v1 (12 botones fijos). Si en el futuro anadimos paginas (Xpace Creator, Tienda, Musica), incrementaremos `version` y emitiremos:

```js
window.addEventListener('admiraxp-sd-pages-changed', (ev) => {
  // ev.detail.pages contiene el catalogo actualizado
});
```

Tambien emitimos `admiraxp-sd-press` con `{ok, button, result}` cada vez que se dispara una accion — util para feedback visual en el LCD (verde si `ok:true`, rojo si `false`).

---

## 6. Limitaciones conocidas v1

- **Solo una pagina** (`admira-events`). Las paginas 2 y 3 estan reservadas para Xpace Creator y Tienda, las anadire cuando tengamos el flujo de la pagina 1 funcionando end-to-end con el Galleon.
- **El comando solo funciona si hay partida activa.** Si el usuario esta en el menu/seleccion de era, el dispatcher devuelve `needsGame is not defined` (esperado). Considera pintar las teclas en gris hasta que el game emita un evento de "partida activa" — puedo expornerlo si lo quieres.
- **i18n por idioma del juego.** El idioma se elige en menu al arrancar. Si quieres mostrar EN/ES segun `lang`, lee `window.lang` o suscribete a `admiraxp-sd-pages-changed`.

---

## 7. Quick test

Abre la consola del juego y prueba:

```js
// 1. Verifica que el bridge esta cargado
window.AdmiraXP_StreamDeck.version           // → "1.0.0"
window.AdmiraXP_StreamDeck.pages.length      // → 1
window.AdmiraXP_StreamDeck.manifest().pages[0].buttons.length  // → 12

// 2. Dispara una accion
await window.AdmiraXP_StreamDeck.press('admira-events', 1)
// → {ok:true, button:{id:'gc',...}, result:'🚓 Guardia Civil entrando...'}

// 3. Ver historico
window.AdmiraXP_StreamDeck._lastResults.slice(0,3)
```

---

## 8. Contactos / siguiente paso

- **Claude (Admira XP / game side):** mantiene `assets/js/streamdeck.js` y el manifest, anade paginas nuevas, extiende `elgato-proxy.js` si lo piden.
- **Codex (Galleon / keyboard side):** consume el manifest, configura iCUE/firmware del Galleon, dispara `press()` cuando el usuario pulsa.

Dime que camino quieres (A/B/C) y cualquier ajuste al schema (mas campos, otro orden, multiples paginas) y itero.
