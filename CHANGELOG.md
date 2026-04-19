# Changelog

## [1.2.0] — 2026-04-19

### Añadido
- **Envío de prueba** (`POST /send/:id/test`): desde la tarjeta "Certificado" de cada campaña puedes enviar un email real con el PDF generado a cualquier dirección sin afectar el estado de los asistentes ni la campaña. Permite especificar el nombre a usar (o toma el más largo de la lista).
- **QR de verificación en certificados**: genera un QR con un token único por asistente que apunta a una URL de verificación pública. Posición y tamaño configurables en el editor de plantillas.
- **Subdominio de verificación white-label** (`{slug}-certs.manuelalbor.com`): crea un subdominio CNAME en Cloudflare + entrada en el túnel con una sola acción. HTTPS automático via Cloudflare Universal SSL, sin coste adicional. Servicio `cloudflare.js` con `addSubdomain()` / `removeSubdomain()` vía API.
- **Mayúsculas sostenidas opcionales**: toggle por plantilla para forzar el nombre del asistente en `text-transform: uppercase` tanto en el preview como en el PDF generado.
- **Edición inline del nombre de campaña**: click en el título para editarlo en sitio, guarda vía AJAX sin recargar la página.
- **Búsqueda y reenvío masivo en el log**: campo de búsqueda que filtra por nombre, email y estado; checkboxes de selección múltiple con acción de reenvío en lote (`POST /attendees/bulk-resend`).
- **Importación desacoplada del envío**: importar asistentes ya no inicia los correos. El estado de la campaña se resetea a `draft` para que el usuario decida cuándo presionar "Enviar certificados". Mensaje de confirmación lo deja claro.
- **Institución avaladora**: campo opcional de nombre de institución + logo (imagen) que se puede adjuntar a cada campaña para referencia interna.
- **Previsualización CSV antes de importar**: tabla interactiva con selección individual o total de filas antes de confirmar la importación.
- Edición inline de email del asistente en el log de envíos.
- Reenvío individual por asistente desde el log.

### Cambiado
- **Escalado del preview con CSS `cqw`**: sustituye el cálculo JS con `displayScale` por `font-size: N cqw` (`container-type: inline-size`), logrando correspondencia pixel-perfect con el PDF a cualquier tamaño de pantalla sin depender de eventos de imagen.
- **Detección de DPI del SVG** (`parseSvgDimensions`): nueva heurística que detecta SVGs exportados a 300/200/150/120 DPI (viewBox con valores >1000 sin unidades físicas en `width`/`height`). Resuelve el timeout de Gotenberg en SVGs de alta resolución (p.ej. `viewBox="0 0 3300 2550"` → 11"×8.5" en lugar de 34"×26"). Prioridad: unidades físicas → viewBox con DPI heurístico → px a 96 DPI → Letter landscape por defecto.
- El botón de inicio de envío muestra un diálogo de confirmación con el número de asistentes pendientes antes de encolar los jobs.
- Rango del slider de tamaño de fuente ampliado a 300px; tamaño del QR hasta 600px.
- El nombre del archivo PDF adjunto al email preserva correctamente caracteres especiales del español.

### Corregido
- Gotenberg devolvía error 503 (timeout) en plantillas SVG exportadas a 300 DPI con `viewBox` grande.
- La escala del nombre y QR en el preview no coincidía con el PDF exportado.
- Asistentes importados en campañas en estado `done` o `error` no desbloqueaban el botón de envío.
- Línea `fontSize` duplicada en `nameStyle` del editor de plantillas causaba valor incorrecto en preview.

---

## [1.1.0] — 2026-04-18

### Añadido
- **Volúmenes Docker nombrados** (`cert_db`, `cert_templates`, `cert_uploads`, `cert_redis`) — datos persistentes que sobreviven a recreaciones de contenedores y actualizaciones de imagen
- **Vista de configuración del email** (`/campaigns/:id/email`):
  - Toggle texto plano / HTML
  - Editor con sintaxis apropiada según formato
  - Preview en iframe en tiempo real (renderiza el email con el nombre más largo como muestra)
  - Referencia de variables disponibles (`{nombre}`)
  - Nota recordatoria de que el PDF se adjunta automáticamente
- **Optimización del tamaño PDF**:
  - `parseSvgDimensions()` lee `viewBox` y atributos `width`/`height` del SVG con soporte de unidades (mm, cm, pt, px, in) para ajustar el paper size de Gotenberg exactamente al arte
  - Elimina márgenes en blanco → PDFs más compactos
  - `estimatePdfSize()` analiza el SVG y muestra rango estimado de KB por PDF en el editor de plantillas
  - Detecta imágenes rasterizadas embebidas (base64) y advierte sobre su impacto en el tamaño
- **Log de envíos** (`/campaigns/:id/log`):
  - Tabla paginada (100 registros/página) con filtros por estado
  - **Edición inline del email** del destinatario sin recargar la página (Alpine.js + fetch)
  - **Botón de reenvío individual** — resetea el asistente a `pending` y crea un job inmediato en BullMQ
  - Columna `resent_at` para rastrear cuándo se realizó un reenvío
  - Columna de error con mensaje completo en tooltip
- **Pestañas de navegación** en todas las vistas de campaña: Campaña / Email / Log
- Soporte HTML completo en `sendCertificate()`: envía `html` + fallback `text` cuando `email_is_html=1`
- Migraciones inline en `db/index.js` para aplicar nuevas columnas en bases de datos existentes

### Cambiado
- `generateCertificate()` ahora retorna `{ buffer, sizeKb, dimensions }` en lugar de solo el buffer
- Nombre del archivo PDF adjunto preserva caracteres especiales del español
- Worker loguea el tamaño del PDF generado en KB

Todos los cambios notables de este proyecto están documentados aquí.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.0.0/)
y el proyecto usa [Semantic Versioning](https://semver.org/lang/es/).

---

## [1.0.0] — 2026-04-18

### Añadido
- Gestión de **plantillas SVG**: upload del arte del certificado
- **Previsualizador interactivo**: posicionamiento del nombre mediante drag & click sobre la plantilla, con controles de fuente, tamaño, color, alineación, negrita e itálica
- Gestión de **campañas**: nombre del evento, fecha, configuración de lotes e intervalo
- **Import CSV** de asistentes (columnas: `email`, `asistente`) con validación de emails y deduplicación
- Generación de **PDF personalizado** via Gotenberg (servicio ya existente en el stack) — SVG + nombre superpuesto como overlay posicionado por CSS
- **Preview PDF** con el nombre más largo de la lista de asistentes
- Gestión de **perfiles SMTP** múltiples con contraseñas encriptadas (AES-256-CBC)
- Botón de **test de conexión SMTP** via Nodemailer verify
- **Envío por lotes** con BullMQ + Redis:
  - Tamaño de lote configurable (default: 30 emails/lote)
  - Intervalo entre lotes configurable (default: 10 min)
  - Delay calculado por posición del asistente en la cola
  - Reintentos automáticos (3 intentos, backoff exponencial)
  - Concurrencia de 3 jobs en paralelo
- **Control de envío**: iniciar / pausar campañas
- **Dashboard de progreso**: barra de progreso, estadísticas en tiempo real (polling 10s o SSE `/send/:id/progress`)
- **Exportación CSV** de resultados por campaña
- Base de datos SQLite embebida (sin contenedor extra) con 4 tablas: `smtp_profiles`, `templates`, `campaigns`, `attendees`
- Integración con **Traefik** vía etiquetas Docker para `certs.manuelalbor.com`
- Protección con **Authentik SSO** (`authentik@docker` middleware)
- Stack Docker: `cert-sender-web`, `cert-sender-worker`, `cert-sender-redis`

### Stack técnico
- Node.js 24 + Express + EJS
- BullMQ 5 + ioredis
- Nodemailer
- better-sqlite3
- Gotenberg 8 (PDF)
- Tailwind CSS + Alpine.js (CDN)
