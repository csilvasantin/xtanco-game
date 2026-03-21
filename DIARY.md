# XTANCO Digital Twin — Diario de Desarrollo

---

## [v2.1] — 2026-03-21

### Interactividad, packs de muebles, visitas y lámpara inteligente

**Sesión de refinamiento:** mejoras de gameplay, interactividad física y virtual, y sistema de visitas comerciales.

---

### Pack Mostrador + Caja Registradora + Monitor PC

- Los tres elementos ahora son **un solo objeto movible** en el editor
- Al mover el mostrador, la caja y el monitor se mueven juntos
- Label unificado: "Mostrador+Caja+PC"
- **Caja registradora**: LCD verde con dinero en tiempo real, botones, cajón de efectivo
- **Monitor PC**: pantalla azul "XTANCO" con cursor parpadeante y LED de encendido

### Sistema de visitas (pestaña LOCAL)

Reemplaza el antiguo sistema de publicidad por 4 acciones con impacto real:

| Visita | Efecto | Color monitor | Color botón |
|--------|--------|--------------|-------------|
| 🧑‍💼 **Comercial** | +12 fama, +5 satisfacción | 🟢 Verde | Verde |
| 🔧 **Técnico** | +15 satisfacción, +30% stock | 🔵 Azul | Azul |
| 🏛 **Delegación** | Subvención €500-1000, +8 fama | 🩷 Rosa | Rosa |
| 👮 **Guardia Civil** | Inspección: OK→+10 sat / Multa €400-1000 | ⚫ Negro | Gris |

- Cada visita cambia el **color del monitor** del mostrador durante 5 segundos
- Pantalla parpadea con texto de la visita y borde del color correspondiente
- Menú se cierra automáticamente tras cada acción

### Lámpara de pie interactiva

- **Click en la lámpara** para encender/apagar (o tecla L)
- Dos estados visuales claramente distintos:
  - 💡 **ON**: pantalla crema brillante, halo amarillo en el suelo, cono de luz vertical, bombilla radiante
  - 🌑 **OFF**: pantalla gris oscuro, sin halo, bombilla apagada, todo oscuro
- La lámpara **arranca encendida** por defecto
- Si el proxy Elgato está activo → también controla la **luz física real**
- Toggle visual instantáneo (no espera al proxy)
- Sonido de confirmación en cada toggle

### Mejoras del editor de layout

- Botón **🗑 Eliminar** para borrar objetos (o tecla Delete/Backspace)
- Botón **+ Añadir** para recuperar objetos eliminados
- Layouts antiguos se limpian automáticamente (items obsoletos se eliminan)
- Items nuevos se añaden automáticamente a layouts guardados

### Elgato Key Light — conexión arreglada

- **Causa raíz**: mixed content (HTTPS→HTTP bloqueado) + encoding JSON corrupto en Windows
- **Solución**: proxy Node.js que sirve juego + API en el mismo puerto (localhost:9124)
- JSON se parsea y re-stringify para evitar corrupción de encoding
- Content-Length correcto en headers
- Toggle visual siempre funciona, lámpara real es async en background

### Pájaros en las ventanas

- 🐦 Siluetas de pájaros que vuelan de ventana a ventana
- **8 colores diferentes** que rotan en cada pasada
- Solo visibles a través del cristal (clipeados a las ventanas)
- Desaparecen detrás de las paredes entre ventanas
- Alas batiendo, cabeza con pico naranja, ojo con pupila
- Ciclo de 700 frames por pasada

### Otros ajustes

- 2 plantas eliminadas (quedan 2 en esquinas izquierdas)
- Ventanas movidas 20% más cerca de la pared izquierda (cols 0.5, 4, 7.5)
- Banner LED en pared izquierda a media altura
- Hora punta e inspección solo en barra superior (sin carteles flotantes duplicados)
- Notificación Elgato en barra superior (compacta, no flotante)

---

## [v2.0] — 2026-03-21

### Rediseño isométrico completo + Editor de layout + Integraciones IoT

**Sesión épica de desarrollo:** el juego ha pasado de vista plana 2D a un motor isométrico completo inspirado en Game Dev Story (Kairosoft), con editor visual, integración hardware real y ciudad envolvente.

---

### Motor isométrico

- Nuevo motor isométrico con tiles 2:1 (78x34px), grid 12x6
- Funciones core: `toIso()`, `drawIsoTile()`, `drawIsoBlock()`, `screenToIso()`
- Perspectiva Kairosoft: paredes altas (~40% de la vista), suelo con ángulo pronunciado
- Zona de juego a ancho completo (800px) — sin panel lateral permanente
- Depth sorting por posición Y en pantalla (painter's algorithm)

### Estilo visual Kairosoft

- Paleta cálida: paredes crema/beige, suelo moqueta, muebles de madera
- Ventanas con cielo azul, nubes animadas y edificios de ciudad visibles
- Entorno urbano: ciudad isométrica detrás del estanco con edificios 3D
- Puerta de cristal en pared derecha que se abre/cierra con el tráfico de clientes
- Reloj de pared analógico con hora real del sistema (se mueve cada minuto)
- Banner LED scrolling en pared izquierda con datos en vivo

### Muebles del Xtanco

| Mueble | Descripción |
|--------|-------------|
| Mostrador | Madera, 1x2 tiles, caja registradora con pantalla |
| Estanterías | Madera, 1x2, 4 niveles de productos coloridos |
| Botellero de vinos | 4 niveles de botellas tinto/burdeos tumbadas |
| Terminal lotería | Mesa con monitor digital de números |
| Máquina vending XT-3K | Cuerpo blanco/gris con productos visibles |
| Revistero | Expositor metálico 3 niveles de revistas coloridas |
| Escritorio manager | Mesa verde con laptop y silla de oficina |
| Lámpara de pie | Base oscura, poste madera, pantalla cono crema con halo |
| 4 Plantas | Macetas terracota con follaje verde animado |
| Alfombra | Tapete de bienvenida (pisable, sin colisión) |

### Editor de layout visual

- Acceso: botón ✏️ Edit o tecla E
- Grid isométrico visible con coordenadas por tile
- Click para seleccionar → click en tile para mover
- Flechas para ajuste fino de posición
- Controles de tamaño independientes: Ancho X (−/+) y Alto Y (−/+)
- Shift+flechas para resize por teclado
- Botón 🗑 Eliminar (o tecla Delete/Backspace)
- Botón + Añadir para recuperar objetos eliminados
- 💾 Guardar con sonido de confirmación (doble beep) y notificación visual verde
- ↺ Reset para restaurar layout por defecto
- Todo persiste en localStorage entre sesiones

### Sistema de colisiones

- Mapa de dureza por mueble (FURNITURE_SIZE define el footprint en tiles)
- `isTileBlocked()` verifica si un tile está ocupado
- `canWalkTo()` combina límites del suelo + colisión con muebles
- Store manager no puede atravesar paredes ni muebles
- Clientes: si se bloquean con un mueble → se paran a mirar (browse)
- Clientes saliendo: se deslizan alrededor de obstáculos

### Control del Store Manager

- Teclas Q/A/O/P para movimiento isométrico:
  - Q = Noroeste, A = Sureste, O = Suroeste, P = Noreste
- Posición inicial: centro de la tienda (col:5, row:3)
- Flecha naranja pulsante ▼ sobre la cabeza como indicador
- Nombre en naranja para distinguirlo del personal
- Animación de caminar y giro automático de dirección

### Selección de modelo Xtanco

- 4 modelos: Generic (normal), Good (fácil), Better (difícil), Best (experto)
- Pantalla de selección con tarjetas 2x2
- Cada modelo tiene: staff, productos, capital, targets y dificultad diferentes
- Configuración dinámica: CFG se actualiza según el modelo elegido

### UI estilo Game Dev Story

- Barra superior compacta (28px): Año/Semana, dinero, progreso objetivo
- Barra inferior (30px): Save, Yr Sales, Yr Profit, Satisfacción, Clientes, Edit, Menu
- Panel de gestión como overlay (toggle con Menu o tecla M)
- 4 pestañas: Ventas / Personal / Stock / Local (teclas 1-4)

### Integración Elgato Key Light

- Tecla L alterna la lámpara real del estudio (Elgato Key Light Air)
- Proxy Node.js local (`elgato-proxy.js`) para evitar CORS
- El cielo del juego se pone ROJO cuando la luz está encendida
- Sonido de confirmación + notificación visual
- Manejo de errores silencioso — el juego nunca se congela
- Config: `ELGATO.ip`, `ELGATO.port`, `ELGATO.proxyPort`

### Documentación para IA

- `CODEX.md`: documentación completa de 700+ líneas pensada para que otra IA (Codex, GPT, Claude) pueda entender y extender el proyecto
- Cubre: arquitectura, motor isométrico, estados, modelos, layout, colisiones, rendering, entidades, controles, muebles, UI, integraciones, constantes, inputs

### Responsive + Touch

- Canvas escala a pantalla completa manteniendo aspect ratio 8:5
- Soporte táctil para móvil (touch → click)
- Meta tags no-cache para servir siempre la última versión

### Deploy

- GitHub Pages: https://csilvasantin.github.io/xtanco-game/
- Para jugar con lámpara Elgato: `node elgato-proxy.js` + localhost

---

## [v0.3] — 2026-03-21

### Rediseño completo: estilo Game Dev Story (Kairosoft)

**Referencia adoptada:** Game Dev Story (Kairosoft, 1998) — el juego que estableció el estándar del simulador de gestión de negocio en pixel art.

**Cambios:**
- Vista top-down estática del local, igual que la oficina de Game Dev Story
- Personajes chibi animados en sus puestos (cabeza grande, cuerpo pequeño, ojos parpadeantes)
- Clientes que entran por la puerta, exploran el local y salen satisfechos o no
- Panel lateral de gestión con 4 pestañas: VENTAS / PERSONAL / STOCK / LOCAL
- Sistema de contratación y formación de empleados (hasta nivel 5)
- Barras de energía, nivel y burbujas de diálogo por empleado
- Progresión semanal con pago de salarios automático
- Decay natural de stock por semana
- Números flotantes al vender (+€)
- Sistema de eventos aleatorios (cola en caja, stock bajo, premio de lotería...)
- Minimapa de la planta en la pestaña LOCAL

**Puestos de trabajo implementados:**
| Rol | Función |
|-----|---------|
| Cajero/a | Genera ventas, mostrador principal |
| Repositor/a | Gestiona estanterías |
| Lotería | Terminal de lotería activa |
| Encargado/a | Boost general de satisfacción |

**Productos gestionables:**
Tabaco, Vapes, Lotería, Prensa, Chuches, Recarga móvil

---

## [v0.2] — 2026-03-21

### Menú inicial con selección de idioma (ES / EN)

**Cambios:**
- Pantalla de menú con grid animado y estrellas de fondo
- Selección de idioma: Castellano 🇪🇸 / English 🇬🇧 con teclas ← →
- Sistema i18n completo: todas las cadenas de texto traducidas
- Todos los textos del juego (etiquetas, interacciones, overlays, HUD) pasan por el sistema i18n
- HUD y barra de controles se actualizan al seleccionar idioma

---

## [v0.1] — 2026-03-21

### Prototipo inicial: plataformas estilo Mario

**Primer prototipo funcional del Xtanco Digital Twin.**

**Características:**
- Juego de plataformas 2D lateral estilo Super Mario
- Personaje controlable con físicas (movimiento + salto + gravedad)
- Interior de estanco futurista en pixel art con neones
- Elementos interactivos con tecla E: mostrador, estanterías, máquina vending, terminal de lotería, puerta
- Panel de datos flotantes en tiempo real (simulados)
- Minimapa de planta

**Elementos del estanco Generic:**
- Mostrador con TPV digital
- Estantería Smart (3 niveles)
- Máquina Vending XT-3000
- Terminal de Lotería
- Acceso principal con sensor de aforo

---

## [v1.0-beta] — 2026-03-21

### Primera beta jugable completa — estilo Game Dev Story

**Bucle de juego completo: 5 años, objetivos, puntuación final.**

**Novedades:**

**Sistema de estados:**
- Menú → Tutorial (3 pantallas) → Juego → Fin de año → Juego → ... → Fin de partida
- Pantalla de pausa (ESC) con resumen semanal

**Tutorial interactivo (3 pantallas):**
- Bienvenida y objetivo del juego
- Gestión de personal
- Eventos especiales y consejos

**Progresión por años:**
- 5 años de juego, 8 semanas por año
- Objetivo de ingresos por año: €2.200 / €5.800 / €12.000 / €23.000 / €40.000
- Si no alcanzas el 55% del objetivo → Game Over

**Pantalla de Fin de Año (inspirada en Game Dev Story):**
- Barra de ingresos animada vs objetivo
- Rating: D / C / B / A / S con colores y brillo
- Bonus o penalización según rating
- S (≥150%): +€2.500 | A (≥120%): +€1.200 | B (≥100%): +€400 | C: €0 | D: -€600

**Pantalla de Fin de Partida:**
- Score total, clientes atendidos, años completados
- Ranking: Kiosco de Barrio → Estanco Conocido → Estanco Popular → Estanco Referente → Xtanco Legendario

**Eventos especiales:**
- ⚡ Hora punta: multiplicador x2.4 de ventas + glow naranja en el local
- 🔍 Inspección: si tienes stock bajo o sin personal → multa aleatoria €600-1000

**Mejoras de local:**
- Nivel 2 (€4.500): desbloquea más referencias en estanterías + boost de satisfacción

**Guardado automático:**
- localStorage — la partida se guarda al fin de cada semana y año

**Economía balanceada:**
- Cajero/a L1: ~€140/semana de ingresos, €130/semana de salario
- Objetivo año 1 alcanzable con 1-2 empleados entrenados a nivel 2-3

---

## Roadmap

| Versión | Objetivo | Estado |
|---------|----------|--------|
| v0.1 | Prototipo plataformas Mario | ✅ |
| v0.2 | Menú idioma ES/EN | ✅ |
| v0.3 | Rediseño Game Dev Story | ✅ |
| v1.0-beta | Bucle completo 5 años | ✅ |
| v2.0 | Motor isométrico + editor + IoT | ✅ |
| v2.1 | Interacción manager-muebles (vender, reponer) | 🔜 |
| v2.2 | Diálogos con clientes al acercarse | 🔜 |
| v2.3 | Muebles Altadis específicos (góndolas, vitrinas) | 🔜 |
| v2.4 | Sonido ambiente + música chiptune | 🔜 |
| v3.0 | Datos en tiempo real via API | 🔜 |

---

## Stack técnico

- HTML5 Canvas — vanilla JS, sin dependencias
- Single-file deployable
- GitHub Pages: https://csilvasantin.github.io/xtanco-game/
- Repositorio: https://github.com/csilvasantin/xtanco-game
