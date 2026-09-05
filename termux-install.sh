#!/data/data/com.termux/files/usr/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# AdmiraXperience Game — instalador para Termux (Android)
#
# Levanta el gemelo digital (game.html / index.html) en tu móvil con un solo
# comando. NO instala la app Termux en sí (eso se hace desde F-Droid / Play
# Store); prepara el entorno DENTRO de Termux y arranca el juego en local.
#
# Uso, ya dentro de Termux:
#   curl -fsSL https://raw.githubusercontent.com/csilvasantin/01.-admiraxperience-game/claude/termux-mobile-install-pko3O/termux-install.sh | bash
# o, si ya clonaste el repo:
#   bash termux-install.sh
#
# Variables opcionales:
#   ADMIRA_PORT   Puerto del servidor local (por defecto 8080)
#   ADMIRA_DIR    Carpeta de instalación (por defecto ~/AdmiraXperience)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="https://github.com/csilvasantin/01.-admiraxperience-game.git"
BRANCH="claude/termux-mobile-install-pko3O"
PORT="${ADMIRA_PORT:-8080}"
DIR="${ADMIRA_DIR:-$HOME/AdmiraXperience}"

say()  { printf '\033[35m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# 0. Sanity: ¿estamos en Termux?
if [ -z "${PREFIX:-}" ] || [ ! -d "/data/data/com.termux" ]; then
  warn "Esto no parece Termux. El script está pensado para ejecutarse DENTRO de la app Termux en Android."
  warn "Si aún no la tienes: instala Termux desde F-Droid (https://f-droid.org/packages/com.termux/)."
fi

# 1. Actualizar índices e instalar dependencias
say "Actualizando paquetes de Termux…"
pkg update -y && pkg upgrade -y

say "Instalando git y nodejs…"
pkg install -y git nodejs

command -v git  >/dev/null 2>&1 || die "git no se instaló correctamente."
command -v node >/dev/null 2>&1 || die "node no se instaló correctamente."
ok "git $(git --version | awk '{print $3}') · node $(node --version)"

# 2. Obtener el repositorio (clonar o actualizar)
if [ -d "$DIR/.git" ]; then
  say "El repo ya existe en $DIR — actualizando rama $BRANCH…"
  git -C "$DIR" fetch origin "$BRANCH"
  git -C "$DIR" checkout "$BRANCH"
  git -C "$DIR" pull origin "$BRANCH"
elif [ -f "$(pwd)/game.html" ] && [ -f "$(pwd)/index.html" ]; then
  say "Ya estás dentro del repo — usando $(pwd)"
  DIR="$(pwd)"
else
  say "Clonando $REPO_URL en $DIR…"
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$DIR"
fi
ok "Repositorio listo en $DIR"

# 3. Arrancar el servidor estático
cd "$DIR"
IP="$(ip route get 1 2>/dev/null | awk '{print $7; exit}' || true)"
[ -z "${IP:-}" ] && IP="127.0.0.1"

cat <<BANNER

  ╭───────────────────────────────────────────────╮
  │  AdmiraXperience // The Xpace OS  —  Termux     │
  ╰───────────────────────────────────────────────╯

  Sirviendo el gemelo digital en local:

    En este móvil:   http://localhost:${PORT}/index.html
    En tu red WiFi:  http://${IP}:${PORT}/index.html

  Para parar el servidor: pulsa Ctrl+C
  Para volver a arrancar:  cd ${DIR} && node termux-serve.js

BANNER

# Usamos un servidor Node mínimo y sin dependencias (no requiere npm install).
exec node termux-serve.js "$PORT"
