# XTANCO — Digital Twin Game

## 1 2 3 basico

1. leer `onboarding` y el contexto del proyecto;
2. avanzar el juego sin perder la direccion del digital twin;
3. cerrar con HTML y URL publica verificable.

Videojuego pixel art estilo Super Mario que representa un **digital twin** de los estancos del futuro de la red Xtanco.

## Concepto

Cada estanco tiene una réplica digital interactiva en formato de juego 2D pixelado. El jugador puede explorar el espacio, interactuar con los elementos del local y ver datos en tiempo real de cada zona.

## Modelos de Xtanco

| Modelo | Estado | Descripción |
|--------|--------|-------------|
| **Xtanco Generic** | ✅ v0.1 | Planta genérica base |
| **Xtanco Good** | 🔜 Próximamente | Estanco pequeño optimizado |
| **Xtanco Better** | 🔜 Próximamente | Estanco mediano con más servicios |
| **Xtanco Best** | 🔜 Próximamente | Estanco flagship completo |

## Cómo jugar

| Control | Acción |
|---------|--------|
| `← →` | Mover personaje |
| `↑` / `Espacio` | Saltar |
| `E` | Interactuar con elementos |

## Elementos del estanco (Generic)

- **Mostrador** — TPV digital, gestión de ventas en tiempo real
- **Estantería Smart** — Stock auto-sincronizado, 48 referencias
- **Máquina Vending XT-3000** — Pagos NFC/crypto, temperatura controlada
- **Terminal Lotería** — Conexión SCR en vivo, validación QR
- **Acceso Principal** — Control de aforo, cámaras activas

## Stack técnico

- HTML5 Canvas (vanilla JS)
- Sin dependencias externas
- Single-file deployable

## Roadmap

- [ ] Xtanco Good — layout pequeño, 1 planta
- [ ] Xtanco Better — layout mediano, zona lounge
- [ ] Xtanco Best — layout premium, múltiples plantas
- [ ] Datos en tiempo real via API
- [ ] Modo editor de planta
- [ ] Versión móvil (touch controls)
- [ ] Personajes NPC (clientes, empleados)
- [ ] Sistema de inventario jugable

## Regla de cierre

Al cerrar una sesion relevante:

1. dejar una salida en HTML;
2. publicar una URL comprobable;
3. si se usa `Nomeacuerd0`, asumir que solo evita acceso casual.
