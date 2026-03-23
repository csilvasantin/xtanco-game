# XTANCO Digital Twin — Diario de Desarrollo

---

## [v2.5] — 2026-03-23

### Sesión completa: 8 mejoras mayores + condiciones + IoT (Hue + Elgato)

**20 commits, de v1.38 a v1.55.** El Xtanco pasa de beta funcional a experiencia inmersiva con sonido, pathfinding, eventos dinámicos, IoT real y panel de condiciones.

---

### 1. Sistema de Sonido (SFX Engine)

- Motor SFX con Web Audio API — 11 sonidos sintetizados sin archivos externos
- Sonidos: cashRegister, doorBell, salePop, hireFanfare, restockThud, rushSiren, inspectionAlarm, weekEnd, gameOver, levelUp, eventChime, thunder, rainLoop
- Botón FX en el HUD para activar/desactivar efectos sonoros
- Volumen controlado por `G.sfxVolume` (persiste en save)

### 2. Pathfinding A*

- Los clientes ahora navegan entre muebles con pathfinding real
- `buildWalkGrid()` genera mapa 13x7 desde `isTileBlocked()`
- `astarPath()` con heurística Manhattan, 4 direcciones
- Path se recalcula al entrar/salir del editor
- Clientes siguen waypoints para ir y volver a la puerta

### 3. Eventos Variados (6 nuevos)

| Evento | Prob/tick | Efecto |
|--------|----------|--------|
| Festivo | 0.001 | Ventas x1.8, +50% clientes, 200 ticks |
| Oferta Proveedor | 0.0008 | Restock -50% un producto, 300 ticks |
| Lluvia | 0.0004 | -50% clientes, efectos visuales y sonoros |
| Sol | 0.0004 | +30% clientes |
| Cliente VIP | 0.0005 | Cliente dorado, ventas x5 |
| Robo | 0.0004 | -30% stock (prevenible con ≥3 staff) |
| Empleado del Mes | 0.0003 | +30 moral, +1 nivel staff random |

### 4. Gráficos de Progreso

- Mini chart de revenue/semana en la pestaña Ventas
- Línea de progreso con área rellena
- Línea discontinua roja para el target semanal
- Datos guardados en `G.weekHistory[]`

### 5. Animaciones de Transición

- Fade-to-black entre estados del juego
- Aplicado en: menú→selección, juego→fin de año, fin→menú
- No aplicado en pause (instantáneo)

### 6. Tutorial Interactivo Guiado

- 9 pasos sobre el juego real (no slides estáticas)
- Guía: contratar → reponer → publicidad → entrenar → guardar
- Auto-avance en pasos de espera, espera input en pasos de acción
- Botón SKIP disponible

### 7. Mobile UX

- Detección automática de dispositivo móvil
- Swipe izq/der para cambiar tabs
- Swipe arriba/abajo para abrir/cerrar menú
- D-pad virtual para movimiento (Q/A/O/P)
- Indicador de swipe en pantalla

### 8. Leaderboard Local

- Top 10 puntuaciones por modelo en localStorage
- Medallas 🥇🥈🥉 para top 3
- Mostrado en pantalla de Game End
- Entrada actual resaltada si entra en ranking

### 9. Pestaña CON (Condiciones) — reemplaza STOCK

Nueva pestaña con 5 secciones:

**TIEMPO** — Estado meteorológico + 3 botones selectores
- 🌤 Normal | 🌧 Lluvia | ☀ Sol
- El tiempo dura mínimo 2 horas de juego
- Selector manual activa efectos inmediatamente

**AFLUENCIA** — Tasa de clientes en tiempo real
- Barra de porcentaje con modificadores activos
- 4 botones de tipo de visitante:
  - ⭐ VIP (gasta x5, habanos)
  - 🔁 Frecuente (fiel, tabaco habitual)
  - 👤 Casual (lotería, vapes)
  - ❓ Desconocido (primera visita)
- Tipo seleccionado se muestra en el monitor del mostrador

**HORARIO** — Reloj + 3 botones de periodo
- 🌅 Mañana (9-13h): café y prensa
- ☀️ Tarde (14-18h): tabaco y lotería
- 🌙 Noche (19-21h): vapes y recargas
- Saltar entre periodos cambia hora del juego

**FRECUENCIA VISITA** — Estadísticas de clientes
- Hoy / Media por semana / Total acumulado

**STOCK** — Stock medio + botón REPONER TODO

### 10. Tormenta Visual y Sonora

- Gotas de lluvia animadas en el cielo y calles
- Nubes oscuras y pesadas (7 nubes vs 4 normal)
- Cielo oscurecido con overlay azul-gris
- Relámpagos (flash blanco aleatorio cada ~5s)
- Trueno SFX (sawtooth grave) con cada rayo
- Sonido ambiental de lluvia (triangle wave sutil)
- Charcos con reflejos en las calles

### 11. Publicidad Condicionada en Pantalla Admira

| Tiempo | Anuncio Admira |
|--------|---------------|
| 🌧 Lluvia | Vapeadores + nubes de vapor + "Día de lluvia, día de vapor" |
| ☀ Sol | Paquete cigarrillos + sol + "Sol y terraza, mejor momento" |
| Normal | Fortuna con eslóganes rotativos (5 mensajes) |

### 12. Integración IoT

**Elgato Key Light** (192.168.0.109)
- Sincronizada con hora del juego
- Mañana: OFF | Tarde: gradual 20→80% | Noche: ON 100%
- Botones de periodo envían comandos inmediatos

**Philips Hue** (Bridge 192.168.1.37)
- Lampara Despacho (#9) y Lampara Comedor (#8)
- Sync cada 2 segundos con hora del juego:
  - Mañana: luz fría natural (ct=250)
  - Tarde: cálida progresiva
  - Noche: cálida máxima (ct=366, bri=254)
- Tormenta: flash azul frío (xy=[0.18,0.18], alert=lselect)
- API Key: `fsj2dkVBF0wOtDUvdMnisfdyBZHSqPHULmQ3ehQ0`

### 13. UI/UX

- Botón Quit en barra superior (guarda + para música + vuelve al menú)
- Cursor pointer sobre elementos clickables
- Versión visible en esquina del menú
- Bottom bar ajustada a 34px sin overlap
- Store Manager reposicionado delante de pantalla Admira

---

## [v2.4] — 2026-03-22

### Sesión maratón: DJ, música, persistencia, contador, competencia y mejoras masivas

**40+ commits en una sola sesión.** El Xtanco ha pasado de ser un simulador estático a un juego vivo con música, personal interactivo, persistencia real y datos de mercado.

---

### Hilo musical del Xtanco

- **3 canciones** incluidas como MP3 en `/music/`:
  - Titi Me Pregunto - Bad Bunny
  - Careless Whisper - George Michael
  - La Perla - Rosalia
- **Controles interactivos en HUD**: nota musical clickable para mutear + flechas prev/next
- La musica empieza automaticamente al iniciar partida
- Tecla **M** para mutear/desmutear
- Cancion actual visible en la barra superior con titulo y artista
- Loop automatico: al acabar una cancion pasa a la siguiente

### Perfil DJ (5to empleado)

| Caracteristica | Detalle |
|----------------|---------|
| Coste | 200 euros |
| Musica | Novah - Hard Techno (exclusiva, no en playlist normal) |
| Efecto visual | Todos los empleados y clientes bailan |
| Bocadillos | "Altadis Party!!" en rosa para todo el staff |
| Lampara | Efecto strobe (parpadeo rapido ON/OFF) |
| Clientes | Bob animado + notas musicales flotantes |

- La cancion de Novah SOLO se puede activar contratando al DJ
- Al despedir al DJ, vuelve la musica normal y el comportamiento estandar

### Uniforme del equipo Xtanco

- Todos los empleados llevan **camiseta azul con una X blanca** en el pecho
- Los clientes NUNCA visten de azul (colores 1-5, excluyendo indice 0)
- Pelo siempre negro para empleados (pelo de Altadis)
- Distincion visual inmediata entre staff y clientes

### Sistema de contratacion/despido mejorado (PER)

- Boton **ECHAR** funcional para cada empleado
- Al despedir: bocadillo "Bye Bye!" + animacion de salida por la puerta
- **Recontratacion**: al volver a pulsar CONTRATAR, el empleado regresa a su puesto
- Toggle hire/fire para los 5 roles: Cajero, Repositor, Azafata, Store Manager, DJ

### Contador de personas (HUD)

- **Icono de camara** con numero de personas actualmente en la tienda
- **Flecha verde hacia arriba**: total de entradas del dia
- **Flecha roja hacia abajo**: total de salidas del dia
- Solo cuenta clientes (no empleados)
- Se resetea cada dia de juego
- Posicionado junto al dinero en la barra principal

### Cuota de mercado (barra superior)

4 cajas con los competidores de tabaco en Espana:

| Marca | Cuota | Color |
|-------|-------|-------|
| ALTADIS | 28% | Amarillo |
| JTI | 27% | Rojo |
| PM | 23% | Azul |
| BAT | 22% | Gris |

### Pantalla Admira interactiva (TFT pared izquierda)

- Click en productos del menu STO → muestra info en pantalla Admira durante 10 segundos
- Muestra: nombre, barra de stock, porcentaje, precio por unidad
- Header "ADMIRA" en dorado
- Prioridad: Stock > Fiesta > Ogro (delegacion) > Altadis (default)
- **Cuando staff toca a un cliente**: pantalla muestra "FIESTA!!" con confeti
- Correccion de perspectiva: texto correctamente orientado en la pared isometrica

### Ciclo de dia completo

- Reloj de pared marca hora del juego (09:00→21:00 en 5 minutos reales)
- Cielo dinamico: azul mañana → naranja atardecer → purpura → noche
- Lampara progresiva: 16h=10%, 17h=35%, 18h=60%, 19h=85%, 20h=100%
- Elgato Key Light fisica sincronizada con intensidad progresiva
- Settings de tienda: hora apertura/cierre configurable

### Fecha real en HUD

- Reemplazado "AÑO 1 SEM 1" por **fecha real** (22/03/2026)
- "Ingresos Dia" visible junto a la fecha
- Euro siempre detras de la cantidad (3500 euros)

### Layout persistente

- Los cambios de posicion de muebles se guardan en **localStorage** con clave dedicada
- Boton RESET graba la posicion actual como nuevo default
- Al recargar la pagina, se restaura la ultima posicion guardada
- El layout sobrevive actualizaciones del codigo (clave separada del versionado)

### Cesped exterior

- Zona fuera del Xtanco rellena con **cesped verde isometrico** con patron de rombos
- El shop ocupa 13x7 tiles (ampliado +1 col y +1 row respecto a v2.2)

### Puerta de cristal mejorada

- Logo XTANCO solo en una puerta (no centrado entre las dos)
- Puerta siempre renderizada por encima de muebles (z-order correcto)
- Animacion de apertura/cierre cuando entran/salen clientes

### Ventanas ajustadas

- 3 ventanas (no 4)
- Movidas 10% mas arriba y mas cerca de la puerta
- Pajaros animados de colores distintos pasan entre ventanas

### Sistema de cache resuelto

- `index.html` = loader que redirige a `game.html?v=timestamp`
- Service Worker con cache-busting en activacion
- Nunca mas se carga una version antigua

### Correcciones tecnicas

- Variable duplicada `hh` → renombrada
- Menu siempre visible (fondo oscuro contrastado)
- Mapa de dureza en muebles (colisiones staff + clientes)
- Puerta de cristal sin triangulo transparente
- Renders envueltos en try/catch para evitar crashes
- `cx.save()/restore()` alrededor de cada funcion de render

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
| v2.1 | Interactividad, packs, visitas, lampara IoT | ✅ |
| v2.2 | Ciclo de dia, cielo dinamico, iluminacion progresiva | ✅ |
| v2.3 | Fecha real, ingresos dia, contador personas | ✅ |
| v2.4 | DJ, musica, competencia, persistencia, cesped | ✅ |
| v2.5 | Dialogos con clientes, misiones diarias | 🔜 |
| v2.6 | Muebles Altadis especificos (gondolas, vitrinas) | 🔜 |
| v3.0 | Datos en tiempo real via API | 🔜 |

---

## Stack técnico

- HTML5 Canvas — vanilla JS, sin dependencias
- Single-file deployable
- GitHub Pages: https://csilvasantin.github.io/xtanco-game/
- Repositorio: https://github.com/csilvasantin/xtanco-game
