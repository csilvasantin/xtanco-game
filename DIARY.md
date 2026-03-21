# XTANCO Digital Twin — Diario de Desarrollo

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

## Roadmap

| Versión | Objetivo |
|---------|----------|
| v0.4 | NPCs con IA mejorada, colas en caja |
| v0.5 | Xtanco Good — planta pequeña específica |
| v0.6 | Xtanco Better — planta mediana con zona lounge |
| v0.7 | Xtanco Best — flagship, múltiples zonas |
| v1.0 | Datos en tiempo real via API, modo editor de planta |

---

## Stack técnico

- HTML5 Canvas — vanilla JS, sin dependencias
- Single-file deployable
- GitHub Pages: https://csilvasantin.github.io/xtanco-game/
- Repositorio: https://github.com/csilvasantin/xtanco-game
