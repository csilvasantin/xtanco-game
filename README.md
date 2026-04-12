# Admira XP // The Xpace OS

## 1 2 3 basico

1. leer `onboarding` y el contexto del proyecto;
2. avanzar el juego sin perder la direccion del digital twin;
3. cerrar con HTML y URL publica verificable.

Admira XP es el catalogo vivo de experiencias operativas de Admira. `The Xpace OS` es la capa compartida donde conviviran distintos juegos por cliente, empezando por **Xtanco** como vertical de estancos y creciendo hacia **Loterias**, **Retail** y otros escenarios.

## Concepto

Cada cliente tendra su propio simulador jugable, construido sobre el mismo motor: layout, staff, stock, eventos, metricas y sistemas visuales especializados para su operativa real.

Hoy el simulador activo es **Xtanco**, centrado en estancos.

## Simuladores

| Simulador | Estado | Descripción |
|-----------|--------|-------------|
| **Xtanco / Estancos** | ✅ Activo | Gestión de estancos, staff, stock y operaciones de tienda |
| **Admira Loterías** | 🔜 Próximamente | Sorteos, campañas, terminal y picos estacionales |
| **Admira Retail** | 🔜 Próximamente | Experiencia de sala, tráfico y venta omnicanal |

## Escenarios de Xtanco

| Modelo | Estado | Descripción |
|--------|--------|-------------|
| **Xtanco Generic** | ✅ Activo | Planta genérica base |
| **Xtanco Good** | ✅ Activo | Estanco pequeño optimizado |
| **Xtanco Better** | ✅ Activo | Estanco mediano con más servicios |
| **Xtanco Best** | ✅ Activo | Estanco flagship completo |

## Cómo jugar

| Control | Acción |
|---------|--------|
| `← →` | Mover personaje |
| `↑` / `Espacio` | Saltar |
| `E` | Interactuar con elementos |

## Elementos del Xtanco (Generic)

- **Mostrador** — TPV digital, gestión de ventas en tiempo real
- **Estantería Smart** — Stock auto-sincronizado, 48 referencias
- **Máquina Vending XT-3000** — Pagos NFC/crypto, temperatura controlada
- **Terminal Lotería** — Conexión SCR en vivo, validación QR
- **Acceso Principal** — Control de aforo, cámaras activas

## Stack técnico

- HTML5 Canvas (vanilla JS)
- Sin dependencias externas
- Single-file deployable

## Configuracion local

1. copia `xtanco.config.example.json` a `xtanco.config.local.json`;
2. rellena ahi Elgato y Hue o usa variables `XTANCO_*`;
3. arranca `node elgato-proxy.js`;
4. abre `http://localhost:9124`.

Archivos de apoyo:

- `xtanco-version.js` define `version` y `build` para `index.html` y `sw.js`.
- `xtanco-runtime-config.js` es la configuracion segura para publicacion; el proxy local la sobreescribe en runtime.
- `xtanco.config.local.json` queda fuera de git y evita exponer claves en Pages.

## Roadmap

- [x] Xtanco Good — layout pequeño, 1 planta
- [x] Xtanco Better — layout mediano, zona lounge
- [x] Xtanco Best — layout premium, múltiples plantas
- [ ] Admira Loterías — primer vertical no-Xtanco
- [ ] Admira Retail — experiencia de tienda conectada
- [ ] Datos en tiempo real via API
- [ ] Modo editor de planta
- [ ] Versión móvil (touch controls)
- [ ] Personajes NPC (clientes, empleados)
- [ ] Sistema de inventario jugable

## Regla de cierre

Al cerrar una sesion relevante:

1. dejar una salida en HTML;
2. publicar una URL comprobable;
3. comprobar el build/caché final en la URL publicada;
4. si se usa `Nomeacuerd0`, asumir que solo evita acceso casual.
