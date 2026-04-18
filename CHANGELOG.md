# Changelog

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
