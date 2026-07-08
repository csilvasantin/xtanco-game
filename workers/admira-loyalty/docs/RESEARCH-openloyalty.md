# Open Loyalty — Chuleta de integración técnica (PoC servicio puente)

> Objetivo: que un agente construya un servicio puente contra **Open Loyalty CLOUD (producto comercial actual, headless loyalty engine)** sin releer los docs.
> Fecha de investigación: 2026-07-08. Todas las afirmaciones llevan su fuente al lado.

## Fuentes y aviso legacy

- **Producto ACTUAL (comercial cloud)** → `help.openloyalty.io/technical-guide` + `help.openloyalty.io/api-reference` + `apidocs.openloyalty.io`.
  - Truco: cualquier página de `help.openloyalty.io/...` sirve su **markdown limpio** añadiendo `.md` al final de la URL (p.ej. `.../add-member.md`). El índice completo está en `https://help.openloyalty.io/llms.txt`.
- **LEGACY / open-source (NO es el producto actual)** → `docs.openloyalty.io/en/latest/...` y los repos GitHub `OpenLoyalty/*` open-source (Symfony v3.x). Aviso de Carlos confirmado: el **Open Source Edition (v3.2) es solo para testing no comercial**, sin garantías de rendimiento ([search softwareadvice/openloyalty.io]). **Usar solo como referencia histórica, nunca como base del PoC.** El paradigma legacy (`/api/customer`, comandos CQRS) NO coincide 1:1 con el cloud actual (`/api/{storeCode}/...`).
- El repo oficial `github.com/OpenLoyalty/api-docs` existe pero carga vacío por SPA; solo tiene `doc/openapi-new/` (3 commits). No aporta sobre los .md de help.

---

## 1. AUTENTICACIÓN

Fuente: [help.openloyalty.io/technical-guide/authentication/admin-token](https://help.openloyalty.io/technical-guide/authentication/admin-token), [.../access-token-api-key](https://help.openloyalty.io/technical-guide/authentication/access-token-api-key), [.../member-token](https://help.openloyalty.io/technical-guide/authentication/member-token), [.../getting-started-guide/authentication](https://help.openloyalty.io/technical-guide/getting-started-guide/authentication)

**Concepto clave: `storeCode`.** Es el identificador del tenant y va en el PATH de casi todos los endpoints: `/api/{storeCode}/...`. Se obtiene con `GET /api/store` (endpoint admin sin storeCode). [member-registration-configuration]

### Tres mecanismos de auth (elegir uno)

**A) Admin JWT (recomendado para el puente server-to-server):**
- `POST /api/admin/login_check` con body `{ "username": "...", "password": "..." }` → responde `{ "token": "<JWT>", "refresh_token": "<...>" }`.
- Usar en cada request: header `Authorization: Bearer <JWT>`.
- **TTL del JWT: 24 h.** Refrescar con `POST /api/token/refresh` body `{ "refresh_token": "..." }`.
- Rate limit: login y refresh limitados a **20 RPM** (sube a 40 RPM el 15-sep-2026). [limits]

**B) Access Token / API Key permanente (X-AUTH-TOKEN) — la mejor opción para un servicio puente sin renovación:**
- Se genera en el panel admin: **Settings → Admin → (elegir admin) → Generate new key** (nombre + expiración opcional). Se muestra UNA vez.
- Header: `X-AUTH-TOKEN: <customPermanentToken>` (también admite query param, pero usar header).
- **No expira** salvo que se configure expiración. Ejemplo oficial:
  ```
  curl -L https://<env-url>/api/{storeCode}/member \
    -X GET -H "Accept: application/json" \
    -H "X-AUTH-TOKEN: customPermanentToken"
  ```
- Nota: los ejemplos solo cubren contexto admin; asumir alcance de admin API. **Para el puente: usar A o B con credenciales de admin.**

**C) Member token (client/customer API) — EVITAR:**
- `POST /api/{storeCode}/member/login_check` (login del miembro final) devuelve JWT de miembro.
- Alcance MUY limitado (solo: auth, reset password, campaigns, history, profile, rewards, wallets del propio miembro). Para todo lo demás hace falta admin token.
- **Los docs avisan: "el member token ya no está soportado y se descontinuará pronto".** No construir el puente sobre esto.

### Admin API vs Client API
- **Admin API** = todo bajo `/api/{storeCode}/...` con admin JWT o X-AUTH-TOKEN. Es donde el puente debe operar (crear members, emitir eventos, transacciones, leer wallets, etc.).
- **Client/Member API** = subconjunto self-service que un miembro autenticado usa sobre sus propios datos. No relevante para un backend puente.

### Base URL de un tenant cloud
- Patrón: `https://<env-url>/api/{storeCode}/...`. El `<env-url>` concreto lo asigna Open Loyalty al provisionar el tenant (no hay dominio público fijo documentado; se recibe al contratar/activar staging). [access-token-api-key ejemplo usa `http://your-env-url`]

---

## 2. MEMBERS

Fuente: [api-reference/member.md](https://help.openloyalty.io/api-reference/member.md), [getting-started-guide/add-member.md](https://help.openloyalty.io/technical-guide/getting-started-guide/add-member.md), [member-registartion-configuration.md](https://help.openloyalty.io/technical-guide/getting-started-guide/member-registartion-configuration.md)

- **Crear:** `POST /api/{storeCode}/member`
  ```json
  { "customer": { "email": "john@example.com", "firstName": "John", "lastName": "Smith", "gender": "male" } }
  ```
  Campos soportados: `email`, `phone`, `loyaltyCardNumber`, `firstName`, `lastName`, `birthDate`, `address`, `company`, `labels`, `agreement1/2/3`, `levelId`, `customFieldsData`.
  Respuesta: objeto member con `customerId` (UUID generado por OL), `defaultAccount` (saldos de puntos), `currentLevel` (tier), timestamps, flags `active`/`anonymized`.

- **Identificador requerido (configurable por tenant):** se exige **UN** identificador único entre `email`, `phone` o `loyaltyCardNumber`. Se configura con `PATCH /api/{storeCode}/settings` → `{ "identificationMethod": "email" | "phone" | "loyaltyCardNumber" }`. `loyaltyCardNumber` es único por tenant y case-sensitive. [limits, member-registration-configuration]

- **Buscar/listar:** `GET /api/{storeCode}/member` con filtros `customerId`, `email`, `phone`, `loyaltyCardNumber`, `active`, `levelId`, `labels` (patrón `key1;value1,key2;value2`), fechas, y campos de `defaultAccount` (`activePoints`, etc.). Paginación `_page` + `_itemsOnPage` + `_orderBy`. Ver §6/§8.

- **Get single:** `GET /api/{storeCode}/member/{member}` donde `{member}` puede ser el UUID **o** `email=...` / `phone=...` / `loyaltyCardNumber=...`. Muy útil para resolver por nuestro identificador sin listar.

- **Actualizar:** `PUT` (reemplaza) / `PATCH` (parcial, ideal para `labels` y `customFieldsData`) sobre `/api/{storeCode}/member/{member}`.

### Mapeo a nuestro modelo (visitante anónimo + cuenta B2B)
- **memberId (visitante anónimo estable):** no hay "miembro anónimo" nativo con visitorId. Estrategia: crear un member usando **`loyaltyCardNumber` = nuestro visitorId** (configurar `identificationMethod=loyaltyCardNumber`, que permite prescindir de email/phone). Así `GET /member/{loyaltyCardNumber=<visitorId>}` resuelve directo. Alternativa: guardar el visitorId en `customFieldsData` o `labels` y buscar por filtro.
- **accountId B2B:** modelar como `label` (`account;<accountId>`) o `customField` en el member, para poder filtrar/segmentar por cuenta. No existe entidad "organización/cuenta" separada en la API de members.

---

## 3. CUSTOM EVENTS

Fuente: [getting-started-guide/add-custom-event.md](https://help.openloyalty.io/technical-guide/getting-started-guide/add-custom-event.md), [getting-started-guide/add-custom-event-schema.md](https://help.openloyalty.io/technical-guide/getting-started-guide/add-custom-event-schema.md), [main-features/custom-events](https://help.openloyalty.io/main-features/custom-events)

- **Paso 1 — definir schema (una vez por tipo de evento):** `POST /api/{storeCode}/customEvent/schema`. El schema declara el `type` (identificador de sistema) y los atributos/condiciones que las campañas/achievements pueden inspeccionar. Éxito = `204 No Content`. Un custom event **solo puede enviarse vía API** y **requiere schema previo**.

- **Paso 2 — emitir evento:** `POST /api/{storeCode}/customEvent`
  ```json
  {
    "event": {
      "type": "app_login",
      "eventDate": "2024-05-01T00:00:00",
      "customerData": { "email": "john@example.com" }
    }
  }
  ```
  - `type`: debe coincidir con un schema existente.
  - `customerData`: conecta el evento a un member. Campos aceptados: `customerId`, `email`, `phone`, `loyaltyCardNumber` (usar el que case con nuestro mapeo — p.ej. `loyaltyCardNumber = visitorId`).
  - `body`/atributos: valores según las condiciones del schema.
  - Respuesta: `200 OK` con el id del custom event creado.

- **Cómo dan puntos:** el evento no da puntos por sí solo. Se crea una **Campaign** o **Achievement** con trigger tipo *Custom Event* que, al cumplirse las condiciones del schema, aplica efectos (`give_points`, etc.). Ver §5 y la página de trigger [custom-event trigger](https://help.openloyalty.io/main-features/campaigns/campaigns-and-referral-campaigns/creating-campaigns/trigger-types/custom-event).

- **Límite de paginación al leer eventos:** `_page` máx 500. [limits]

---

## 4. TRANSACTIONS

Fuente: [getting-started-guide/add-transaction.md](https://help.openloyalty.io/technical-guide/getting-started-guide/add-transaction.md), [api-reference/transactions](https://help.openloyalty.io/api-reference/transactions)

- **Endpoint:** `POST /api/{storeCode}/transaction`
  ```json
  {
    "transaction": {
      "items": [
        { "sku": "12AB", "name": "Restaurant", "quantity": 1, "grossValue": 500, "category": "dine" }
      ],
      "header": {
        "documentType": "sell",
        "documentNumber": "12345",
        "purchasePlace": "onsite",
        "purchasedAt": "2024-05-01T00:00:00",
        "labels": []
      },
      "customerData": { "email": "john@example.com" }
    }
  }
  ```
  Mínimos: `items[]` (sku, name, quantity, grossValue, category), `header` (documentType, documentNumber, purchasePlace, purchasedAt), `customerData`.

- **transaction vs custom event:**
  - Usar **transaction** cuando el evento tiene **valor monetario / cesta de productos** (compra, devolución con `documentType`). Habilita reglas por importe, por SKU/categoría, filtros de items, distribución porcentual.
  - Usar **custom event** para eventos **no monetarios / de comportamiento** (login, visita, check-in, scan) que quieras puntuar por reglas propias.
  - Al aplicarse efectos de campaña se dispara el webhook `CampaignEffectWasApplied`.

---

## 5. WALLETS/PUNTOS · TIERS · ACHIEVEMENTS/BADGES · REWARDS/COUPONS · CAMPAIGNS/CHALLENGES

### Wallets / puntos (existe; "units")
Fuente: [api-reference/wallet.md](https://help.openloyalty.io/api-reference/wallet.md)
- OL usa "units" (multi-wallet). Leer saldo de un member: `GET /api/{storeCode}/member/{member}/wallet` →
  ```json
  { "items": [ {
    "walletType": { "walletTypeId": "...", "code": "...", "name": "...", "unitSingularName": "...", "unitPluralName": "..." },
    "account": { "earnedUnits": 0, "transferredUnits": 0, "spentUnits": 0, "activeUnits": 0, "lockedUnits": 0, "blockedUnits": 0, "expiredUnits": 0 },
    "unitsLimitUsed": 0, "unitsLimitRemaining": 0
  } ] }
  ```
- Listar tipos de wallet: `GET /api/{storeCode}/walletType`. Detalle de un wallet: `GET /api/{storeCode}/wallet/{wallet}`.
- Ajuste manual de puntos: no en esta página como endpoint directo; se hace vía **Unit Transfers** (feature de wallets) o vía efectos de campaña. Para el panel bastan los GET de saldo.

### Tiers (existe)
Fuente: [api-reference/tier](https://help.openloyalty.io/api-reference/tier), [main-features/tiers](https://help.openloyalty.io/main-features/tiers)
- Tier actual del member viene en el objeto member (`currentLevel`). Endpoints de tier bajo `/api/{storeCode}/tier`. Cambio de tier emite webhook `CustomerLevelChanged`; aviso previo `LevelWillExpire`.

### Achievements + Badges (existen)
Fuente: [api-reference/achievement.md](https://help.openloyalty.io/api-reference/achievement.md), [main-features/achievements](https://help.openloyalty.io/main-features/achievements), [main-features/badges](https://help.openloyalty.io/main-features/badges)
- Progreso de un member: `GET /api/{storeCode}/member/{member}/achievement` → items con `achievementId`, `achievementName`, `limitReached`, `memberProgress.completedCount`, y `rules[]` con `periodGoal`, `currentPeriodValue`, `consecutivePeriods`, `completedConsecutivePeriods`, `periodType`, `trigger`. **Perfecto para pintar barras de progreso.**
- Lista de achievements: `GET /api/{storeCode}/achievement` (incluye `badgeTypeId`).
- Log de triggers de un member: `GET /api/{storeCode}/achievement/trigger/member/{member}`.
- Badges: feature nativa (`api-reference/badge`), se conceden manual o vía campañas; se ven en el perfil del member.
- El avance de achievement dispara webhook `MemberAchievementProgressWasChanged` **en cada progreso**, no solo al completar.

### Rewards / Coupons (existen)
Fuente: [api-reference/reward.md](https://help.openloyalty.io/api-reference/reward.md)
- Listar: `GET /api/{storeCode}/reward` (filtros+sort). Detalle: `GET /api/{storeCode}/reward/{reward}`.
- **Redimir (canjear por puntos):** `POST /api/{storeCode}/reward/{reward}/buy`. Body según tipo de coupon:
  - StaticCoupon / DynamicCoupon: `customerId`, `quantity`, `withoutPoints`, opc. `couponValue`, `dateValid`, `rewardWalletCode`.
  - ConversionCoupon: `customerId`, opc. `dateValid`, `units`.
  - MaterialReward: `customerId`, `quantity`, `withoutPoints`, opc. `rewardWalletCode`.
  - Respuesta: `[ { "issuedRewardId": "..." } ]`.
- Coupons de un reward: `GET/POST/DELETE /api/{storeCode}/reward/{reward}/coupon[/{couponCode}]`.
- Members elegibles: `GET /api/{storeCode}/reward/{reward}/members`.
- Recompensas de un member (para panel): vista `single-member-view/rewards`; en API se cruza con `issuedReward`/redemptions y webhooks (`CustomerBoughtReward`, `RewardRedemptionStatusChanged`).

### Campaigns / Challenges (existen)
Fuente: [getting-started-guide/create-campaign.md](https://help.openloyalty.io/technical-guide/getting-started-guide/create-campaign.md), [api-reference/campaign](https://help.openloyalty.io/api-reference/campaign), [main-features/challenges](https://help.openloyalty.io/main-features/challenges)
- Crear campaña: `POST /api/{storeCode}/campaign`. Body con `type` ("direct"), `trigger` (`transaction` | `custom event` | `achievement` | ...), `translations`, ventana de actividad, y `rules[].effects[]`.
  - Ejemplo de efecto: `give_points` con `pointsRule: "100"` y `walletCode: "default"`.
- Trigger *Custom Event* enlaza un schema de §3 con la campaña → así los eventos custom otorgan puntos.
- **Challenges** = feature de gamificación (secuencias de achievements) con su vista de member. Los docs recomiendan crear campañas complejas por panel admin (proceso complejo por API).

---

## 6. LEADERBOARDS / RANKINGS

Fuente: [main-features/leaderboards.md](https://help.openloyalty.io/main-features/leaderboards.md) + subpáginas, [how-to-query.md](https://help.openloyalty.io/technical-guide/api-fundamentals/how-to-query.md)

- **Sí existen nativos.** Rankings dinámicos que ordenan members por una métrica. Recalculan **cada 4 h**. Máximo **3 leaderboards activos por entorno**. Soportan empates (misma posición), ciclos temporales (contests mensuales), casos de referidos/producto, y un "rewarding cycle".
- **Limitación clave:** la doc de leaderboards **NO documenta un endpoint API público de lectura de rankings** (se gestionan/ven por panel: `managing-and-viewing-rankings`, `single-member-ranking`). → tratar como laguna (§Lagunas).
- **Ranking por atributo/locationId:** no confirmado como filtro nativo de leaderboard. 
- **Simulación (fallback recomendado para el PoC), p.ej. ranking por punto/tienda:**
  `GET /api/{storeCode}/member?_page=1&_itemsOnPage=50&_orderBy[<campoPuntos>]=desc&labels=location;<locationId>`
  usando el motor de query genérico: `_orderBy[field]=asc|desc`, filtros `field[eq|like|gt|gte|lt|lte]=value`, `labels=key;value,...`. Ordenar por el campo de puntos de `defaultAccount` y filtrar por el `label` de location. (`_itemsOnPage` máx **50**, `_page` máx **500**.) [how-to-query, limits]

---

## 7. WEBHOOKS

Fuente: [main-features/webhooks/configuration.md](https://help.openloyalty.io/main-features/webhooks/configuration.md), [.../what-triggers-a-webhook.md](https://help.openloyalty.io/main-features/webhooks/what-triggers-a-webhook.md), [.../hmac.md](https://help.openloyalty.io/main-features/webhooks/hmac.md), [.../hmac/verifying-the-signature.md](https://help.openloyalty.io/main-features/webhooks/hmac/verifying-the-signature.md), [api-reference/webhook-subscription](https://help.openloyalty.io/api-reference/webhook-subscription)

### Configuración
- **Panel admin:** Webhooks → Add new webhook → elegir evento + URL destino (+ headers custom opcionales) → Add webhook.
- **API:** `GET /api/{storeCode}/webhook/subscription` (listar) · `POST /api/{storeCode}/webhook/subscription` (crear). Body: `eventName` (tipo de evento), `url` (destino), `headers` (opcionales).
- Extra: entrega alternativa a **AWS SQS** ([webhooks/sending-webhooks-to-aws-sqs]); "expiring notifications" configurable.

### Eventos emitidos (identificadores exactos)
- Transacciones/units: `TransactionRegistered`, `TransactionAssignedToCustomer`, `AvailablePointsAmountChanged`, `WalletBalanceUpdated`, `CampaignEffectWasApplied`, `PointsWillExpire`.
- Rewards/coupons: `CustomerBoughtReward`, `RewardRedemptionStatusChanged`, `CouponWillExpire`.
- Members/tiers: `CustomerRegistered`, `CustomerWasRegisteredWithoutActivation`, `CustomerUpdated`, `CustomerRequestedSendActivationCode`, `CustomerRequestedPasswordReset`, `CustomerPhoneNumberWasChanged`, `CustomerEmailWasChanged`, `CustomerLevelChanged` (cambio de tier), `LevelWillExpire`, `CustomerDeactivated`.
- Achievements: `MemberAchievementProgressWasChanged` (en cada progreso).
- Mapeo a lo que pedía Carlos: **puntos añadidos** → `AvailablePointsAmountChanged`/`WalletBalanceUpdated`/`CampaignEffectWasApplied`; **tier change** → `CustomerLevelChanged`; **reward desbloqueada/redención** → `CustomerBoughtReward`/`RewardRedemptionStatusChanged`; **expiración** → `PointsWillExpire`/`CouponWillExpire`/`LevelWillExpire`.

### Firma / verificación (HMAC)
- Algoritmo: **HMAC-SHA256** (indicado en header `X-Webhook-Signature-Algorithm`).
- Headers de la request entrante:
  - `X-Webhook-Signature` — la firma hex.
  - `X-Webhook-Timestamp` — Unix seconds; **rechazar si > 5 min** (anti-replay).
  - `X-Webhook-Signature-Algorithm`, y un request-id (`X-Webhook-Request-Id` según ejemplo).
- **Qué se firma:** una cadena canónica = `METHOD\n{len}:{host}\n{len}:{path}\n{sha256(rawBody)}\n{timestamp}\n{requestId}`. Leer el **raw body tal cual** (no re-serializar).
- **Secret:** se genera al activar HMAC en la creación del webhook; se muestra **una sola vez** (no recuperable, solo rotación). Prefijo `whsec_` → **quitarlo** antes de usar como clave HMAC. Guardar en secrets manager.
- Comparación en **tiempo constante** (`timingSafeEqual`). Ejemplo Node.js oficial disponible en verifying-the-signature.md.

### Reintentos / entrega
- La página de configuración **no documenta política de reintentos ni garantías de entrega** (best-practices y AWS SQS aparte). → laguna (§Lagunas). Asumir posible re-entrega → hacer el consumidor **idempotente por request-id/evento**.

---

## 8. IDEMPOTENCIA Y RATE LIMITS

Fuente: [api-fundamentals/limits.md](https://help.openloyalty.io/technical-guide/api-fundamentals/limits.md), [environments-capabilities.md](https://help.openloyalty.io/technical-guide/api-fundamentals/environments-capabilities.md), [how-to-query.md](https://help.openloyalty.io/technical-guide/api-fundamentals/how-to-query.md)

- **Idempotency keys:** **NO documentados** en la API (no hay header de idempotencia). → el puente debe garantizar idempotencia por su cuenta (dedupe por documentNumber en transactions, por eventId propio en custom events, etc.).
- **Rate limits:**
  - Auth (`/api/admin/login_check`, `/api/token/refresh`): **20 RPM** por cliente (→ **40 RPM** desde 15-sep-2026).
  - Resto de endpoints: sin límite RPM por-endpoint documentado; el techo es de **capacidad por entorno**: Production hasta ~1.200 req/s (soft), Staging **50 req/s**.
  - Timeout de API: **30 s**.
- **Paginación:** `_itemsOnPage` máx **50**; `_page` máx **500**. Mecanismo `_scroll` (separado de `_page`, no combinable) para recorrer grandes volúmenes ([scroll-mechanism-for-pages]).
- **Query genérico:** `_orderBy[field]=asc|desc`; filtros `field[eq|like|gt|gte|lt|lte]=value`; combinar con `&`.
- Límites de datos: import/export máx 100 MB, 5 concurrentes; strings 255 chars; expresiones 500 chars; enteros int32; floats hasta 6 decimales; `loyaltyCardNumber` único por tenant y case-sensitive.

---

## 9. SANDBOX / TRIAL

Fuente: [environments-capabilities.md](https://help.openloyalty.io/technical-guide/api-fundamentals/environments-capabilities.md), [openloyalty.io/book-a-demo](https://www.openloyalty.io/book-a-demo), búsquedas softwareadvice/capterra

- **Dos entornos cloud:** **Production** (SLA 99.9%, ~1.200 req/s, regiones EU Dublin/Frankfurt, US Ohio, APAC Singapore/Sydney) y **Staging** = *"designed for proof of concept (PoC) integration and functional testing"*, **50 req/s**, sin SLA, regiones EU Dublin / US Ohio / APAC Sydney. **El Staging es el "sandbox" para el PoC.**
- **Cómo conseguirlo HOY (no tenemos tenant):** no hay self-service signup público del producto comercial. Vía = **Book a demo** en `openloyalty.io/book-a-demo` (formulario) para pedir acceso comercial + entorno **Staging**. Al provisionar recibes `<env-url>`, `storeCode` y credenciales admin.
- **Open Source Edition (v3.2):** existe y es gratis, pero **solo testing no comercial, sin garantías** — sirve para experimentar la mecánica pero **NO equivale al cloud actual** (endpoints y features difieren). Referencia histórica, no base del PoC.
- **Recomendación PoC:** diseñar el puente contra las specs de este documento y **abstraer OL tras una interfaz** (ver Lagunas); conmutar a Staging real en cuanto se active el tenant. Mientras, se puede mockear con los shapes JSON de aquí.

---

## LAGUNAS (lo que los docs NO aclaran → abstraer tras interfaz en el PoC)

1. **`<env-url>` real del tenant:** no hay dominio público documentado; se recibe al provisionar. → base URL debe ser **configurable** (env var), no hardcodeada.
2. **Miembro anónimo nativo:** no existe "visitorId anónimo" de primera clase. Workaround propuesto: `loyaltyCardNumber = visitorId` o `customFieldsData`. Validar en Staging que se puede crear member sin email/phone con `identificationMethod=loyaltyCardNumber`.
3. **Cuenta B2B (accountId):** sin entidad "organización" en la API. Modelar como `label`/customField del member. Confirmar si hace falta agrupación/segmento server-side.
4. **Leaderboards por API:** feature nativa pero **sin endpoint de lectura de rankings documentado**, y sin confirmación de ranking por `locationId`/metadata. → el PoC debe implementar ranking por **query de members ordenados por puntos + filtro por label** (§6) y encapsularlo tras `getLeaderboard()`.
5. **Reintentos y garantías de entrega de webhooks:** no documentados. → consumidor **idempotente** por `X-Webhook-Request-Id`+evento; asumir at-least-once.
6. **Idempotency keys en escrituras:** no existen. → dedupe propio (documentNumber en transactions, eventId en custom events).
7. **Rate limits de escritura fuera de auth:** solo hay techo de capacidad por entorno (50 req/s en Staging). → backoff/cola en el puente.
8. **Ajuste manual de puntos por API:** el endpoint directo no aparece en wallet.md; se hace vía Unit Transfers o efectos de campaña. Confirmar el endpoint de Unit Transfer si el puente necesita sumar/restar units programáticamente.
9. **Shape exacto del body de cada webhook:** los identificadores de evento están confirmados, pero el JSON completo por evento remite a la API reference (`apidocs.openloyalty.io`, SPA) — verificar contra payloads reales en Staging antes de fijar los DTOs.
10. **Header exacto del request-id del webhook:** el ejemplo usa un `requestIdHeader` en la firma canónica; confirmar nombre literal (`X-Webhook-Request-Id`) con una entrega real.
11. **X-AUTH-TOKEN vs client API:** los docs solo ejemplifican X-AUTH-TOKEN en contexto admin; asumir alcance admin. Confirmar si sirve para endpoints client si algún día se necesitara.

---

### TL;DR de arquitectura del puente
- Auth: **X-AUTH-TOKEN** (API Key permanente de un admin) o admin JWT con refresh cada 24 h.
- Todo va a `https://<env-url>/api/{storeCode}/...` (ambos configurables).
- Escrituras: `POST /member`, `POST /customEvent` (+ schema previo), `POST /transaction`.
- Lecturas para panel: `GET /member/{id}/wallet`, `/member/{id}/achievement`, `GET /reward`, member object (`currentLevel`).
- Redención: `POST /reward/{id}/buy`.
- Webhooks: `POST /webhook/subscription`, verificar `X-Webhook-Signature` (HMAC-SHA256, quitar `whsec_`, canonical string, timestamp < 5 min), consumidor idempotente.
- Sandbox = entorno **Staging** vía **book-a-demo**; sin self-service.
