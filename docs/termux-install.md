# Instalar y correr AdmiraXperience en el móvil con Termux

Guía para levantar el gemelo digital **AdmiraXperience // The Xpace OS** en un
teléfono Android usando [Termux](https://termux.dev). El juego es HTML estático
(`index.html` → `game.html`), así que en el móvil basta con un pequeño servidor
local: no hace falta `npm install` ni dependencias.

> ⚠️ **Importante:** la app **Termux** se instala desde el teléfono (F-Droid).
> Ningún script ni asistente puede instalarla por ti de forma remota. Lo que
> automatizamos aquí es lo que pasa **dentro** de Termux una vez instalado.

---

## 1. Instalar la app Termux (una sola vez, desde el móvil)

1. Instala **F-Droid**: <https://f-droid.org/> (descarga el APK y permite
   instalar de orígenes desconocidos si Android lo pide).
2. Desde F-Droid, busca e instala **Termux**.
   - Enlace directo: <https://f-droid.org/packages/com.termux/>
3. (Opcional) Instala también **Termux:API** si más adelante quieres acceso a
   sensores/cámara.

> No uses la versión de Termux de Google Play: está deprecada y desactualizada.
> La de F-Droid es la mantenida.

---

## 2. Instalar el juego (un solo comando, dentro de Termux)

Abre Termux y pega:

```bash
curl -fsSL https://raw.githubusercontent.com/csilvasantin/01.-admiraxperience-game/claude/termux-mobile-install-pko3O/termux-install.sh | bash
```

El script:

1. actualiza los paquetes de Termux,
2. instala `git` y `nodejs`,
3. clona el repo en `~/AdmiraXperience`,
4. arranca el servidor local y te imprime la URL.

Cuando termine verás algo como:

```
En este móvil:   http://localhost:8080/index.html
En tu red WiFi:  http://192.168.1.42:8080/index.html
```

Abre esa URL en el navegador del móvil (Chrome/Firefox) y ya tienes el gemelo
corriendo. La primera URL (`localhost`) funciona en el propio teléfono; la de
`192.168.x.x` sirve para abrirlo desde otro dispositivo de la misma WiFi.

---

## 3. Instalación manual (si prefieres paso a paso)

```bash
# 1. Dependencias
pkg update -y && pkg upgrade -y
pkg install -y git nodejs

# 2. Clonar el repo
git clone --branch claude/termux-mobile-install-pko3O --depth 1 \
  https://github.com/csilvasantin/01.-admiraxperience-game.git ~/AdmiraXperience
cd ~/AdmiraXperience

# 3. Arrancar el servidor (puerto 8080 por defecto)
node termux-serve.js
```

Para parar el servidor: `Ctrl+C`.
Para volver a arrancarlo: `cd ~/AdmiraXperience && node termux-serve.js`.

---

## 4. Opciones

| Quiero…                          | Cómo                                                        |
|----------------------------------|------------------------------------------------------------|
| Otro puerto                      | `node termux-serve.js 9000` · o `ADMIRA_PORT=9000` antes del script |
| Otra carpeta de instalación      | `ADMIRA_DIR=~/mi-carpeta` antes de lanzar el script         |
| Actualizar a la última versión   | `cd ~/AdmiraXperience && git pull`                          |
| Que no se apague la pantalla     | Activa el *wakelock* de Termux desde la notificación        |

---

## 5. Problemas frecuentes

- **`pkg: command not found`** → no estás dentro de Termux. Abre la app Termux,
  no la terminal del sistema.
- **El puerto ya está en uso** → arranca en otro puerto: `node termux-serve.js 8081`.
- **No carga desde otro dispositivo** → ambos deben estar en la **misma WiFi** y
  el firewall del router no debe aislar clientes. Usa la IP `192.168.x.x` que
  imprime el script.
- **Funciones que llaman a la nube (Tube, loyalty, marketplace…)** → necesitan
  los Cloudflare Workers / proxy `elgato-proxy.js`, que esperan el origin
  `csilvasantin.github.io`. En local funcionará el gemelo; algunas integraciones
  remotas darán error CORS — es esperado y no rompe el juego.

---

## 6. ¿Y el proxy de YouTube/Elgato (`elgato-proxy.js`)?

Es **opcional** y solo necesario para `/importTube` y similares. Requiere
`yt-dlp`:

```bash
pkg install -y python
pip install -U yt-dlp
node elgato-proxy.js   # escucha en el puerto que defina XTANCO_PORT (ver script)
```

Para uso normal del gemelo en el móvil no hace falta.
