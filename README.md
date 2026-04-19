# Cert Sender

Aplicación para generar y enviar **certificados de participación personalizados** en PDF a miles de asistentes por correo electrónico, con envío segmentado en lotes para proteger el servidor SMTP.

## Características

- Sube tu arte en **formato SVG** y posiciona el nombre del asistente de forma visual (drag & drop)
- Importa asistentes desde **CSV** (`email`, `asistente`) con previsualización antes de confirmar
- Agrega asistentes **manualmente** uno a uno desde la interfaz
- **Preview del certificado** con el nombre más largo de tu lista
- **Envío de prueba** a tu propio email antes de lanzar la campaña
- **QR de verificación** por asistente con subdominio white-label (`tu-slug-certs.manuelalbor.com`)
- **Nombre en mayúsculas** opcional por plantilla
- Envío en **lotes configurables** con intervalo entre cada uno
- Múltiples **perfiles SMTP** (Gmail, Brevo, hosting propio, etc.)
- Contraseñas SMTP **encriptadas** en base de datos (AES-256-CBC)
- **Reenvío individual y masivo** desde el log de envíos con filtro y búsqueda
- **Dashboard de progreso** con estadísticas y estimación de tiempo
- Integrado con el stack Docker existente (Traefik + Authentik + Gotenberg)

---

## Requisitos del stack

| Servicio | Necesario |
|---|---|
| Traefik (proxy_net) | Sí — enrutamiento y SSL |
| Gotenberg | Sí — generación PDF |
| Authentik SSO | Sí — protección de la UI |

---

## Instalación

### 1. Clonar el repositorio

```bash
cd ~/proyectos/apps
git clone https://github.com/malborc/cert-sender.git
cd cert-sender
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
nano .env
```

Variables críticas:

```env
# Clave de encriptación AES-256 (32 bytes en hex = 64 caracteres)
# Generar con:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=<tu_clave_aqui>

# URL del servicio Gotenberg (ya disponible en proxy_net)
GOTENBERG_URL=http://gotenberg:3000

# Cloudflare (solo si usas subdominios de verificación white-label)
CLOUDFLARE_API_TOKEN=<token_con_permisos_DNS_y_Tunnel>
CLOUDFLARE_ZONE_ID=<zone_id_de_tu_dominio>
CLOUDFLARE_TUNNEL_ID=<id_del_tunnel_cloudflared>
CLOUDFLARE_ACCOUNT_ID=<account_id>
VERIFY_BASE_DOMAIN=tudominio.com
```

### 3. Levantar los servicios

```bash
docker compose up -d
```

Los tres contenedores se inician en orden:
1. `cert-sender-redis` (healthcheck antes de continuar)
2. `cert-sender-web` (Express server en :3000)
3. `cert-sender-worker` (BullMQ worker)

### 4. Primer acceso

Accede a `https://certs.manuelalbor.com` — Authentik redirigirá al login SSO.

---

## Uso

### Flujo completo para una campaña

```
1. SMTP         → Configurar perfil de correo + probar conexión
2. Plantillas   → Subir SVG → Posicionar nombre (drag & drop) → Configurar fuente, color, tamaño
3. Campañas     → Nueva campaña → Seleccionar SMTP y plantilla
4. Campaña      → Importar CSV (email, asistente) — previsualizar antes de confirmar
5. Campaña      → Configurar el email que recibirán los asistentes
6. Plantilla    → Envío de prueba a tu propio email para validar el resultado
7. Campaña      → Iniciar envío cuando estés conforme
8. Log          → Seguir el progreso, reenviar errores individualmente o en lote
```

### Formato del CSV

```csv
email,asistente
juan.perez@ejemplo.com,Juan Pérez García
maria.lopez@ejemplo.com,María Cristina López Rodríguez
```

El campo `asistente` puede nombrarse también `name` o `nombre`.

Descarga el CSV de ejemplo desde la interfaz (botón "CSV de ejemplo") para verlo con formato correcto.

### Plantilla SVG

El SVG debe ser el arte completo del certificado **sin el nombre del asistente** (o con un texto genérico que no se edita). La app superpone el nombre mediante CSS posicionado, que Gotenberg renderiza y convierte a PDF.

**Compatibilidad de DPI:** la app detecta automáticamente si el SVG fue exportado a 300, 200, 150, 120 o 96 DPI analizando el `viewBox`, y ajusta el tamaño del papel en consecuencia. Un SVG exportado a 300 DPI con `viewBox="0 0 3300 2550"` se interpreta correctamente como Carta 11"×8.5".

### QR de verificación

Cuando está activado, cada certificado incluye un código QR que apunta a una URL de verificación única:

```
https://svcardiologia-certs.manuelalbor.com/verify/<token>
```

Para configurar el subdominio, introduce un slug en la sección "Subdominio de verificación" de la campaña. La app crea automáticamente el registro DNS en Cloudflare y la entrada en el túnel — el HTTPS queda activo en 1-2 minutos.

---

## Envío de prueba

Antes de iniciar el envío masivo, puedes enviar un certificado real a tu propio email:

1. Abre la campaña → tarjeta "Certificado"
2. Despliega "Envío de prueba"
3. Ingresa tu email (y opcionalmente un nombre específico)
4. Haz clic en "Enviar prueba"

El certificado se genera con Gotenberg y se envía vía el SMTP configurado en la campaña. No modifica el estado de ningún asistente.

---

## Configuración de lotes

| Parámetro | Default | Descripción |
|---|---|---|
| Emails por lote | 30 | Cuántos emails se envían antes de pausar |
| Intervalo | 10 min | Tiempo de espera entre cada lote |

**Ejemplo:** 1.000 asistentes, lote=50, intervalo=5min → 20 lotes × 5 min = ~1h 40min total.

La estimación de tiempo se muestra automáticamente en la campaña antes de iniciar el envío.

---

## Estructura del proyecto

```
cert-sender/
├── docker-compose.yml      # 3 servicios: web, worker, redis
├── Dockerfile              # Node 20 LTS con build tools para better-sqlite3
├── .env.example            # Template de configuración
├── src/
│   ├── server.js           # Express app (puerto 3000)
│   ├── worker.js           # BullMQ email worker
│   ├── db/
│   │   ├── index.js        # Conexión SQLite + migraciones inline
│   │   └── schema.js       # CREATE TABLE statements
│   ├── routes/
│   │   ├── campaigns.js    # CRUD de campañas + logo + dominio
│   │   ├── templates.js    # Upload SVG + config de posición
│   │   ├── attendees.js    # Import CSV, add manual, reenvío, bulk-resend
│   │   ├── smtp.js         # Perfiles SMTP + test de conexión
│   │   ├── send.js         # Iniciar/pausar envío, preview PDF, test send
│   │   └── verify.js       # Página pública de verificación de QR
│   ├── services/
│   │   ├── pdf.js          # Genera PDF via Gotenberg + parseSvgDimensions
│   │   ├── email.js        # Nodemailer wrapper + encrypt/decrypt
│   │   ├── queue.js        # BullMQ setup, addCampaignJobs, pause/resume
│   │   └── cloudflare.js   # Gestión DNS + tunnel ingress via API
│   └── views/              # EJS templates
│       ├── campaigns/      # index, show, new, log, email
│       ├── templates/      # index, edit
│       ├── smtp/           # index, form
│       ├── verify.ejs      # Página pública de verificación
│       └── partials/       # _head, nav
└── data/                   # Bind mounts (NO en git)
    ├── db/                 # cert-sender.db (SQLite)
    ├── templates/          # Archivos SVG subidos
    ├── logos/              # Logos de instituciones
    ├── uploads/            # CSV temporales (se eliminan tras el parse)
    └── redis/              # Persistencia Redis (save 60 1)
```

---

## Esquema de base de datos

```
smtp_profiles  — perfiles de correo (host, puerto, TLS, usuario, contraseña encriptada)
templates      — plantillas SVG con configuración de posición, fuente y QR
campaigns      — eventos con su SMTP, plantilla, lotes, estado y subdominio
attendees      — asistentes con estado (pending/sent/error/skipped), token de verificación
```

---

## Monitoreo

```bash
# Estado de contenedores
docker compose ps

# Logs del servidor web
docker logs cert-sender-web -f

# Logs del worker de emails
docker logs cert-sender-worker -f

# Trabajos en la cola BullMQ
docker exec cert-sender-redis redis-cli LLEN bull:cert-email:wait
```

---

## Despliegue automático

El servicio se incluye en `deploy_vps.sh` como CAPA 4:

```bash
compose_up "/home/malborc/proyectos/apps/cert-sender" "Cert Sender"
```

---

## Seguridad

- Acceso protegido por Authentik SSO (solo usuarios autenticados)
- Contraseñas SMTP almacenadas encriptadas con AES-256-CBC
- Sin puertos expuestos directamente (todo via Traefik + Cloudflare Tunnel)
- Tokens de verificación de QR generados con `crypto.randomUUID()`
- `.env` y `data/` excluidos de git
