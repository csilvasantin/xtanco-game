# EVENTS.md · Mapa de eventos — Gamificación (admira.tv) × Open Loyalty

Compañero de [`ADR-001-openloyalty-gamification.md`](./ADR-001-openloyalty-gamification.md).
Define el **contrato de hechos** que las apps de la lanzadera emiten al puente `admira-loyalty` y cómo cada
uno se traduce a Open Loyalty. Base técnica: [`RESEARCH-openloyalty.md`](./RESEARCH-openloyalty.md).

## Principios (recordatorio del ADR)

- La app **solo emite hechos normalizados**; OL decide puntos/badges/tiers. El navegador nunca escribe a OL.
- Cada hecho entra por `POST /events`, se persiste en la **outbox `loyalty_events`** y un cron lo drena a OL.
- Cada hecho lleva un **`eventId` determinista** para idempotencia (dedupe en la outbox) — ver "Ventana de dedup".
- **`locationId`, `screenId`, `campaignId` van SIEMPRE en `metadata`** (y como `labels` en OL para segmentar).

## Modelo del hecho (envelope común)

```json
{
  "eventId":   "<sha256 determinista, ver por evento>",
  "type":      "wifi.checkin",
  "subjectId": "<visitorId anónimo | accountId B2B>",
  "subjectKind": "visitor",
  "sourceApp": "admira.tv/gamification",
  "occurredAt": "2026-07-08T10:15:00Z",
  "metadata":  { "locationId": "...", "screenId": "...", "campaignId": "...", "...": "..." }
}
```

- **`eventId`** por defecto: `sha256(sourceApp | type | subjectId | ventanaTemporal)`. La *ventana* difiere por
  tipo (columna "Dedup") para colapsar ráfagas del mismo hecho. Colisión de `eventId` en la outbox = descartar
  (idempotencia). Cuando el hecho es de verdad único (una reserva, una compra) se usa su id natural.
- **subjectKind**: `visitor` (anónimo estable → `loyaltyCardNumber` en OL) o `account` (cliente B2B → `label`).
- **Mapeo OL** (criterio RESEARCH §4): **`transaction`** SOLO si hay **valor monetario / cesta**; el resto son
  **`customEvent`** (requieren `POST /customEvent/schema` una vez por tipo antes de emitir — RESEARCH §3).

---

## Tabla resumen

| # | type | Emisor | subjectKind | Mapeo OL | Dedup (ventana `eventId`) | Piloto | Mecánica MVP |
|---|------|--------|-------------|----------|---------------------------|:------:|--------------|
| 1 | `screen.view` | Player / signage admira.tv | visitor | customEvent | 1 / min / (visitor+screen) | | |
| 2 | `qr.scan` | Landing QR admira.tv/gamification | visitor | customEvent | 1 / 5 min / (visitor+screen) | ✅ | Puntos por scan |
| 3 | `wifi.checkin` | Captive portal WiFi | visitor | customEvent | 1 / día / (visitor+location) | ✅ | Puntos por check-in |
| 4 | `queue.join` | App de colas | visitor | customEvent | 1 / evento de cola (queueId) | | |
| 5 | `queue.complete` | App de colas | visitor | customEvent | 1 / evento de cola (queueId) | ✅ | Badge misión completada |
| 6 | `room.booking` | Reservas | account/visitor | customEvent* | 1 / bookingId | | |
| 7 | `signage.proof` | Prueba de emisión (canal) | account | customEvent | 1 / proofId | | |
| 8 | `campaign.interaction` | Contenido interactivo | visitor | customEvent | 1 / min / (visitor+campaign) | | |
| 9 | `ar.experience.start` | Experiencia AR | visitor | customEvent | 1 / sesión (arSessionId) | | |
| 10 | `ar.experience.complete` | Experiencia AR | visitor | customEvent | 1 / sesión (arSessionId) | | Badge (misión AR) |
| 11 | `assistant.action` | Asistente/agente | visitor/account | customEvent | 1 / min / (visitor+actionKind) | | |

\* `room.booking` es `customEvent` salvo que la reserva conlleve **importe cobrado** → entonces `transaction`
(con `items[].grossValue`), según criterio RESEARCH §4.

**Piloto (3):** `wifi.checkin`, `qr.scan`, `queue.complete`.
**Mecánicas MVP (3):** (a) **puntos por check-in/QR**, (b) **badge por misión completada**, (c) **ranking
semanal por `locationId`**.
**Recompensa dummy MVP:** `reward-dummy-cafe` para validar **redención E2E** (ver §Recompensa dummy).

---

## Detalle por evento

### 1. `screen.view`
- **Quién lo emite:** el player/signage de admira.tv cuando un visitante identificado está frente a una pantalla.
- **subjectKind:** `visitor`.
- **Metadata mínima:** `locationId`, `screenId` (+ `contentId`, `dwellMs` opcionales).
- **Mapeo OL:** `customEvent` `type: screen_view` (no monetario). Alto volumen → candidato a rate-limit fuerte.
- **eventId:** `sha256(sourceApp|screen.view|visitorId|floor(ts/60))` → **dedup 1/min por pantalla**.
- **Regla OL (MVP):** ninguna por defecto (solo telemetría/segmentación). Reservado para futuras campañas de exposición.

### 2. `qr.scan` — 🟢 PILOTO
- **Quién lo emite:** la landing de `admira.tv/gamification` al abrir un QR físico (MUPI/pantalla).
- **subjectKind:** `visitor`.
- **Metadata mínima:** `locationId`, `screenId`, `campaignId` (+ `qrId`).
- **Mapeo OL:** `customEvent` `type: qr_scan`.
- **eventId:** `sha256(sourceApp|qr.scan|visitorId|screenId|floor(ts/300))` → **dedup 1/5 min por (visitor+screen)**.
- **Regla OL (MVP):** campaña *Custom Event → give_points* (p.ej. **+10 pts** por scan válido), `walletCode: default`.

### 3. `wifi.checkin` — 🟢 PILOTO
- **Quién lo emite:** el captive portal WiFi al autenticarse un visitante en un local.
- **subjectKind:** `visitor`.
- **Metadata mínima:** `locationId` (+ `ssid`, `screenId` si aplica).
- **Mapeo OL:** `customEvent` `type: wifi_checkin`.
- **eventId:** `sha256(sourceApp|wifi.checkin|visitorId|locationId|YYYY-MM-DD)` → **dedup 1/día por (visitor+location)**.
- **Regla OL (MVP):** campaña *Custom Event → give_points* (**+20 pts** por primer check-in del día); alimenta el
  ranking semanal por `locationId`.

### 4. `queue.join`
- **Quién lo emite:** la app de colas al unirse el visitante a una cola/lista de espera.
- **subjectKind:** `visitor`.
- **Metadata mínima:** `locationId`, `queueId` (+ `position`).
- **Mapeo OL:** `customEvent` `type: queue_join`.
- **eventId:** `sha256(sourceApp|queue.join|visitorId|queueId)` → **1 por evento de cola** (id natural, no ventana temporal).
- **Regla OL (MVP):** sin puntos por defecto; sirve de prerrequisito/telemetría para `queue.complete`.

### 5. `queue.complete` — 🟢 PILOTO
- **Quién lo emite:** la app de colas cuando el visitante completa el servicio (fin de cola atendida).
- **subjectKind:** `visitor`.
- **Metadata mínima:** `locationId`, `queueId` (+ `waitedMs`).
- **Mapeo OL:** `customEvent` `type: queue_complete`.
- **eventId:** `sha256(sourceApp|queue.complete|visitorId|queueId)` → **1 por evento de cola** (id natural).
- **Regla OL (MVP):** **Achievement/badge "Misión completada"** con trigger *Custom Event* → concede badge
  (y opc. **+30 pts**). Es la mecánica (b) del MVP.

### 6. `room.booking`
- **Quién lo emite:** el módulo de reservas de espacios.
- **subjectKind:** `account` (B2B) o `visitor`.
- **Metadata mínima:** `locationId`, `bookingId`, `roomId`, `slot` (+ `amount`, `currency` si hay cobro).
- **Mapeo OL:** `customEvent` `type: room_booking`. **Si hay importe cobrado → `transaction`** (RESEARCH §4):
  `items:[{sku:roomId, name, quantity:1, grossValue:amount, category:"room"}]`, `header.documentNumber = bookingId`.
- **eventId / documentNumber:** `bookingId` (id natural, dedup nativo por `documentNumber` en transactions).
- **Regla OL (MVP):** fuera del MVP; preparado para puntos por reserva o por importe cuando se active.

### 7. `signage.proof`
- **Quién lo emite:** el canal/emisión (admira.tv) al registrar prueba de emisión de un contenido.
- **subjectKind:** `account` (anunciante/cliente).
- **Metadata mínima:** `locationId`, `screenId`, `campaignId`, `proofId` (+ `playedAt`, `spotId`).
- **Mapeo OL:** `customEvent` `type: signage_proof` (hecho de cumplimiento, no monetario en sí).
- **eventId:** `proofId` (id natural, único por reproducción probada).
- **Regla OL (MVP):** fuera del MVP; futura fidelización/reporting B2B por cumplimiento de emisión.

### 8. `campaign.interaction`
- **Quién lo emite:** contenido interactivo (encuestas, juegos, votaciones) en la lanzadera.
- **subjectKind:** `visitor`.
- **Metadata mínima:** `locationId`, `screenId`, `campaignId` (+ `interactionKind`, `value`).
- **Mapeo OL:** `customEvent` `type: campaign_interaction`.
- **eventId:** `sha256(sourceApp|campaign.interaction|visitorId|campaignId|floor(ts/60))` → **dedup 1/min por (visitor+campaign)**.
- **Regla OL (MVP):** fuera del piloto; base para campañas de engagement con `give_points` por interacción.

### 9. `ar.experience.start`
- **Quién lo emite:** el runtime de la experiencia AR al arrancar una sesión.
- **subjectKind:** `visitor`.
- **Metadata mínima:** `locationId`, `screenId`, `arSessionId`, `experienceId`.
- **Mapeo OL:** `customEvent` `type: ar_experience_start`.
- **eventId:** `sha256(sourceApp|ar.experience.start|arSessionId)` → **1 por sesión AR** (id natural).
- **Regla OL (MVP):** sin puntos por defecto; prerrequisito de `ar.experience.complete`.

### 10. `ar.experience.complete`
- **Quién lo emite:** el runtime AR al completar la experiencia.
- **subjectKind:** `visitor`.
- **Metadata mínima:** `locationId`, `screenId`, `arSessionId`, `experienceId` (+ `durationMs`, `score`).
- **Mapeo OL:** `customEvent` `type: ar_experience_complete`.
- **eventId:** `sha256(sourceApp|ar.experience.complete|arSessionId)` → **1 por sesión AR** (id natural).
- **Regla OL (MVP):** puede reutilizar el **badge "Misión completada"** (mecánica b) para experiencias AR marcadas
  como misión; puntos opcionales.

### 11. `assistant.action`
- **Quién lo emite:** el asistente/agente conversacional de la lanzadera al ejecutar una acción con valor.
- **subjectKind:** `visitor` o `account`.
- **Metadata mínima:** `locationId`, `actionKind`, `campaignId?` (+ `intent`, `result`).
- **Mapeo OL:** `customEvent` `type: assistant_action`.
- **eventId:** `sha256(sourceApp|assistant.action|subjectId|actionKind|floor(ts/60))` → **dedup 1/min por (subject+actionKind)**.
- **Regla OL (MVP):** fuera del piloto; futuras recompensas por completar tareas guiadas por el asistente.

---

## Mecánicas del MVP (mapeo a OL)

| Mecánica | Disparador (eventos) | Config en OL | Webhook de sincronía |
|----------|----------------------|--------------|----------------------|
| (a) **Puntos por check-in / QR** | `wifi.checkin`, `qr.scan` | Campaña *Custom Event → give_points* (schema `wifi_checkin`, `qr_scan`), `walletCode: default` | `AvailablePointsAmountChanged` / `WalletBalanceUpdated` / `CampaignEffectWasApplied` |
| (b) **Badge por misión completada** | `queue.complete` (y `ar.experience.complete` como misión) | Achievement con trigger *Custom Event* → concede badge (+ pts opc.) | `MemberAchievementProgressWasChanged` |
| (c) **Ranking semanal por `locationId`** | acumulado de (a)/(b) | Leaderboard nativo **no** legible por API (RESEARCH §6, laguna 4) → simular: `GET /member?_orderBy[<pts>]=desc&labels=location;<id>&_itemsOnPage=50`, encapsulado en `getLeaderboard()` | recomputar tras cada webhook de puntos |

Cada `type` con regla exige su **schema previo** (`POST /customEvent/schema`) — RESEARCH §3.

## Recompensa dummy (validación de redención E2E)

- **Id:** `reward-dummy-cafe` — *"Café gratis (demo)"*, coste bajo en puntos (p.ej. 50 pts).
- **Objetivo:** validar el circuito completo de redención **hoy** (con driver `mock`, luego `live`):
  `getReward` → `POST /reward/{reward}/buy` (`customerId`, `quantity:1`) → respuesta `{ issuedRewardId }`
  (RESEARCH §5).
- **Sincronía:** webhooks `CustomerBoughtReward` y `RewardRedemptionStatusChanged` → espejo local →
  el panel `/gamification` muestra la recompensa canjeada. Expiraciones vía `CouponWillExpire` /
  `PointsWillExpire` / `LevelWillExpire`.
- **Consumidor idempotente:** dedupe por `X-Webhook-Request-Id` + tipo (RESEARCH §7, laguna 5).

## Webhooks OL → Admira (resumen de sincronía)

| Resultado en OL | Webhook(s) | Efecto en Admira |
|-----------------|-----------|------------------|
| Puntos añadidos | `AvailablePointsAmountChanged`, `WalletBalanceUpdated`, `CampaignEffectWasApplied` | Actualiza saldo en espejo/panel |
| Cambio de tier | `CustomerLevelChanged` (aviso `LevelWillExpire`) | Actualiza tier del member |
| Recompensa comprada/redimida | `CustomerBoughtReward`, `RewardRedemptionStatusChanged` | Marca recompensa en panel |
| Expiraciones | `PointsWillExpire`, `CouponWillExpire`, `LevelWillExpire` | Avisos al usuario |
| Progreso de badge/achievement | `MemberAchievementProgressWasChanged` | Barra de progreso de misión |

Todos verificados por **HMAC-SHA256** (`X-Webhook-Signature` + `X-Webhook-Timestamp` < 5 min, sin prefijo
`whsec_`, comparación en tiempo constante) y procesados por un **consumidor idempotente** — RESEARCH §7.
