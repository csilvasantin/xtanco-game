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
2. rellena ahi Elgato, Hue y Telegram o usa variables `XTANCO_*`;
3. arranca `node elgato-proxy.js`;
4. abre `http://localhost:9124`.

Archivos de apoyo:

- `xtanco-version.js` define `version` y `build` para `index.html` y `sw.js`.
- `xtanco-runtime-config.js` es la configuracion segura para publicacion; el proxy local la sobreescribe en runtime.
- `xtanco.config.local.json` queda fuera de git y evita exponer claves en Pages.

## Telegram

Admira XP v9.11 incluye puente bidireccional con Telegram desde el proxy local y una consola inferior 50/50:

- el juego envia mensajes a Telegram via `POST /telegram/send`;
- el bot lee mensajes con polling de la Bot API;
- el juego consume instrucciones via `GET /telegram/commands` y responde con `/telegram/reply`.
- la mitad izquierda de la franja inferior envia texto al bot;
- la mitad derecha muestra enviados, recibidos y respuestas de AdmiraXPBot.
- `/grok` y `/ask` conectan AdmiraXPBot con Grok via el proxy local, sin exponer la API key al navegador.

Configuracion local:

1. En Telegram abre `@BotFather`.
2. Ejecuta `/newbot`, elige nombre y username, y copia el token.
3. Escribe al bot desde el chat o grupo donde lo usaras.
4. Copia `xtanco.config.example.json` a `xtanco.config.local.json`.
5. Rellena:

```json
"telegram": {
  "botToken": "TOKEN_DE_BOTFATHER",
  "chatId": "CHAT_ID_O_GRUPO",
  "allowedChatIds": ["CHAT_ID_O_GRUPO"],
  "polling": true
}
```

Tambien se puede configurar con variables:

```bash
export XTANCO_TELEGRAM_BOT_TOKEN="TOKEN_DE_BOTFATHER"
export XTANCO_TELEGRAM_CHAT_ID="CHAT_ID_O_GRUPO"
export XTANCO_TELEGRAM_ALLOWED_CHAT_IDS="CHAT_ID_O_GRUPO"
node elgato-proxy.js
```

Para activar Grok añade tambien:

```json
"grok": {
  "apiKey": "XAI_API_KEY",
  "baseUrl": "https://api.x.ai/v1",
  "model": "grok-4-latest"
}
```

O usa variable de entorno:

```bash
export XAI_API_KEY="tu-api-key-de-xai"
```

Comandos soportados desde Telegram:

- `/status`, `/staff`, `/stock`
- `/hire 1`, `/hire dj`, `/hire all`
- `/train 1`, `/train all`
- `/restock 2`, `/restock all`, `/restock nombre`
- `/ad 0`, `/ad 1`, `/ad 2`
- `/visit com`, `/visit tec`, `/visit del`, `/visit gc`
- `/weather normal`, `/weather rain`, `/weather sun`
- `/time am`, `/time pm`, `/time night`
- `/reloj 14:30`, `/reloj 9.5`
- `/set money 12000`, `/money 12000`
- `/set sat 90`, `/sat 90`
- `/set fame 80`, `/fame 80`
- `/set week 12`, `/set year 2`
- `/set revenue 5000`
- `/set storeLevel 2`
- `/set customers 30`
- `/song 1`, `/song bad bunny`
- `/pause`, `/resume`, `/menu`
- `/dj on`, `/dj off` activa o desactiva la figura del DJ como cuando se contrata desde el menu.
- `/opinador on`, `/opinador off` hace entrar un personaje que deja su opinion en el totem y se marcha; tambien acepta `happy`, `neutral` o `sad`.
- `/ladron on`, `/ladron off` fuerza la entrada y salida del ladron; al activarse, la camara CCTV muestra la puerta en la pantalla principal.
- `/guardiacivil on`, `/guardiacivil off` fuerza la entrada y salida del Guardia Civil; si hay ladron activo, lo intercepta.
- `/door open`, `/door close`, `/door auto`
- `/lamp`, `/music`, `/next`, `/prev`, `/save`
- `/say texto` muestra el texto como bocadillo del Store Manager en la tienda.
- `/grok pregunta`, `/ask pregunta` consulta a Grok y muestra la respuesta en el panel del juego.
- `/draw dibujo`, `/dibuja dibujo` pide a Grok un pixel art y lo pinta en la pantalla principal de la pared larga.
- `/AdmiraLive texto` publica un mensaje en tiempo real en la pantalla LED de la pared larga; `/AdmiraLive off` lo limpia.
- `/AdmiraTube URL 1|2 audio|mute` muestra un vídeo de YouTube en una o dos pantallas de signage; por defecto intenta sonar con audio y `/AdmiraTube off` vuelve al vídeo normal.

## Personajes y escenas en vivo

La v9.11 convierte Telegram en una consola de dirección de escena. Los personajes entran y salen por la puerta del local, respetan el canvas isométrico y actualizan los paneles del juego.

| Comando | Personaje / escena | Efecto |
|---------|--------------------|--------|
| `/ladron on` | Ladrón | Entra por la puerta, activa alerta y la pantalla principal cambia a CCTV. |
| `/ladron off` | Ladrón | El ladrón sale o huye de la tienda. |
| `/guardiacivil on` | Guardia Civil | Entra, patrulla la tienda y si hay ladrón activo lo intercepta. |
| `/guardiacivil off` | Guardia Civil | Sale por la puerta. |
| `/dj on` | DJ Novah | Activa el DJ real del staff, música, luces, vídeo DJ y cabina. |
| `/dj off` | DJ Novah | Desactiva el DJ y restaura la reproducción normal. |
| `/opinador on` | Opinador | Entra, va al tótem de satisfacción, deja opinión y se marcha. |
| `/opinador happy` | Opinador | Fuerza opinión positiva. |
| `/opinador neutral` | Opinador | Fuerza opinión neutra. |
| `/opinador sad` | Opinador | Fuerza opinión negativa. |
| `/door open` / `/door close` | Puerta | Abre o cierra manualmente la puerta. |

## Pantallas conectadas

| Comando | Pantalla | Efecto |
|---------|----------|--------|
| `/say texto` | Store Manager | Muestra un bocadillo sobre el Store Manager. |
| `/AdmiraLive texto` | LED pared larga | Publica texto en tiempo real en el LED. |
| `/draw dibujo` | Pantalla principal | Pide a Grok un pixel art y lo pinta en la pantalla grande. |
| `/grok pregunta` | Panel del juego | Consulta Grok y devuelve respuesta dentro del juego y Telegram. |
| `/AdmiraTube URL 1 audio` | Signage | Muestra YouTube en una pantalla con audio. |
| `/AdmiraTube URL 2 mute` | Signage | Muestra YouTube en dos pantallas sin audio. |
| `/AdmiraTube off` | Signage | Vuelve a la reproducción normal del juego. |

## Prueba rápida local

1. Arranca `node elgato-proxy.js`.
2. Abre `http://localhost:9124/?v=20260412-v911-opinador`.
3. Entra en partida.
4. Envía desde Telegram o desde la consola inferior:
   - `/dj on`
   - `/ladron on`
   - `/guardiacivil on`
   - `/opinador happy`
   - `/status`
5. Comprueba que `/status` refleja `DJ`, `Ladrón`, `Guardia Civil`, `Opinador`, `Puerta`, `AdmiraLive` y `AdmiraTube`.

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
