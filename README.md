# Cert Sender

Aplicación para generar y enviar **certificados de participación personalizados** en PDF a miles de asistentes por correo electrónico, con envío segmentado en lotes para proteger el servidor SMTP.

## Características

- Sube tu arte en **formato SVG** y posiciona el nombre del asistente de forma visual
- Importa asistentes desde **CSV** (`email`, `asistente`)
- Preview del certificado con el **nombre más largo** de tu lista
- Envío en **lotes configurables** con intervalo entre cada uno
- Múltiples **perfiles SMTP** (Gmail, Brevo, hosting propio, etc.)
- Contraseñas SMTP **encriptadas** en base de datos (AES-256-CBC)
- **Dashboard de progreso** en tiempo real
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
# Clave de encriptación (32 bytes en hex = 64 caracteres)
# Generar con:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

ENCRYPTION_KEY=<tu_clave_aqui>
```

### 3. Levantar los servicios

```bash
docker compose up -d
```

Los tres contenedores se inician en orden:
1. `cert-sender-redis` (healthcheck antes de continuar)
2. `cert-sender-web` (npm install + Express server)
3. `cert-sender-worker` (npm install + BullMQ worker)

### 4. Primer acceso

Accede a `https://certs.manuelalbor.com` — Authentik redirigirá al login SSO.

---

## Uso

### Flujo completo para una campaña

```
1. SMTP → Configurar perfil de correo
2. Plantillas → Subir SVG → Configurar posición del nombre
3. Campañas → Nueva campaña → Seleccionar SMTP y plantilla
4. Campaña → Subir CSV (email, asistente)
5. Campaña → Ver preview PDF → Ajustar posición si es necesario
6. Campaña → Iniciar envío
7. Seguir progreso en el dashboard
```

### Formato del CSV

```csv
email,asistente
juan.perez@ejemplo.com,Juan Pérez García
maria.lopez@ejemplo.com,María Cristina López Rodríguez
```

El campo `asistente` puede nombrarse también `name` o `nombre`.

### Plantilla SVG

El SVG debe ser el arte completo del certificado **sin ningún texto de nombre** (o con un texto genérico que no se modifica). La app superpone el nombre del asistente encima usando CSS posicionado, que Gotenberg convierte a PDF.

---

## Configuración de lotes

| Parámetro | Default | Descripción |
|---|---|---|
| Emails por lote | 30 | Cuántos emails se envían antes de pausar |
| Intervalo | 10 min | Tiempo de espera entre cada lote |

**Ejemplo:** 1,000 asistentes, lote=50, intervalo=5min → 20 lotes × 5 min = ~1h 40min total.

---

## Estructura del proyecto

```
cert-sender/
├── docker-compose.yml      # 3 servicios: web, worker, redis
├── .env.example            # Template de configuración
├── src/
│   ├── server.js           # Express app
│   ├── worker.js           # BullMQ email worker
│   ├── db/                 # SQLite schema y conexión
│   ├── routes/             # campaigns, templates, attendees, smtp, send
│   ├── services/           # pdf (Gotenberg), email (Nodemailer), queue (BullMQ)
│   └── views/              # EJS templates con Tailwind CSS + Alpine.js
└── data/                   # Bind mounts (NO en git)
    ├── db/                 # cert-sender.db
    ├── templates/          # Archivos SVG
    ├── uploads/            # CSV temporales
    └── redis/              # Persistencia Redis
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

# Cola BullMQ en Redis
docker exec cert-sender-redis redis-cli LLEN bull:cert-email:wait
```

---

## Despliegue automático

El servicio se agrega al `deploy_vps.sh` como CAPA 4:

```bash
compose_up "/home/malborc/proyectos/apps/cert-sender" "Cert Sender"
```

---

## Seguridad

- Acceso protegido por Authentik SSO (solo usuarios autenticados)
- Contraseñas SMTP almacenadas encriptadas con AES-256-CBC
- Sin puertos expuestos directamente (todo via Traefik + Cloudflare Tunnel)
- `.env` y `data/` excluidos de git
