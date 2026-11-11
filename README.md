# KLYP Alquileres

PWA para que propietarios lleven la cuenta de sus alquileres desde el móvil: pagos, impagos por inmueble, averías y contacto de cada inquilino.

## Qué incluye

| Dirección | Qué es |
|---|---|
| `/` | Landing con acceso y planes |
| `/app` | La app del propietario (PWA instalable) |
| `/admin` | Panel de administración: usuarios dados de alta, plan de cada uno y límites de cada plan |
| `/healthz` | Comprobación de que el servidor responde |

- **Servidor:** `server.py`, Python 3 sin dependencias externas (no hay `pip install`).
- **Datos:** SQLite en `DATA_DIR/klyp.db` y fotos de averías en `DATA_DIR/uploads`. Todo lo que hay que conservar está en esa carpeta.
- **Acceso:** móvil + clave. La sesión queda abierta un año en el dispositivo.
- **Planes:** Gratis, Básico y Pro, con máximo de inmuebles y de personas invitadas. Los nombres, precios y límites se cambian en `/admin`. El plan de cada usuario lo asigna el administrador a mano: **no hay cobro automático**.

## Si un usuario olvida su clave

1. El usuario le contacta por el medio indicado en `SUPPORT_CONTACT`.
2. En `/admin`, pulse **Código de recuperación** en la fila de ese usuario. Aparece un código de 8 caracteres, válido 24 horas y de un solo uso.
3. Dígaselo al usuario. Él pulsa «He olvidado mi clave», escribe su móvil, el código y una clave nueva, y entra directamente.

Compruebe que quien pide el código es de verdad el titular antes de dárselo. Además, cada usuario puede cambiar su clave desde **Cuenta** si recuerda la actual.

## Variables de entorno

| Variable | Para qué | Valor en Docker |
|---|---|---|
| `ADMIN_PHONE` | Móvil (o móviles separados por comas) de quien administra. La cuenta registrada con ese móvil ve `/admin`. | **Hay que ponerla** |
| `SUPPORT_CONTACT` | Texto con la forma de contactar con usted (por ejemplo `WhatsApp 600 123 456`). Se muestra en «He olvidado mi clave». | Recomendable ponerla |
| `TZ` | Zona horaria para calcular "hoy" y los retrasos | `Europe/Madrid` |
| `PORT` | Puerto | `3000` |
| `DATA_DIR` | Carpeta de datos | `/data` |

## Probar en local

Con Python 3.10 o superior:

```bash
python server.py
```

Con Docker:

```bash
docker compose up --build
```

En los dos casos se abre en http://localhost:3000. Para ver el panel de administración en local, copie `.env.example` como `.env`, ponga su móvil en `ADMIN_PHONE` y regístrese con ese móvil.

## Desplegar en Contabo con Coolify

Los nombres de los menús de Coolify pueden variar un poco según la versión.

### 1. Servidor

1. Contrate un VPS en Contabo con Ubuntu 24.04. Coolify recomienda al menos 2 núcleos y 2 GB de RAM.
2. Entre por SSH e instale Coolify:

   ```bash
   curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
   ```

3. Abra `http://IP-DEL-SERVIDOR:8000` y cree la cuenta de administrador de Coolify.
4. Deje abiertos los puertos 22, 80 y 443. El 8000 es el panel de Coolify.

### 2. Dominio

Cree un registro DNS de tipo A, por ejemplo `alquileres.sudominio.com`, que apunte a la IP del VPS.

### 3. Código

Suba esta carpeta a un repositorio Git (GitHub o GitLab). `.gitignore` ya deja fuera `data/` y `.env`.

### 4. Aplicación en Coolify

1. **New Resource** y elija el repositorio (público, o privado conectando la GitHub App de Coolify).
2. **Build Pack:** `Dockerfile`.
3. **Ports Exposes:** `3000`.
4. **Domains:** `https://alquileres.sudominio.com`. Coolify pide el certificado HTTPS solo.
5. **Environment Variables:** `ADMIN_PHONE` con su móvil y `SUPPORT_CONTACT` con su forma de contacto.
6. **Persistent Storage:** añada un volumen (Volume Mount) con destino `/data`. **Sin este paso los datos se pierden en cada despliegue.**
7. **Health Check:** ruta `/healthz`, puerto `3000`.
8. Pulse **Deploy**.

### 5. Primer uso

1. Abra `https://alquileres.sudominio.com/app?registro` y cree su cuenta con el móvil de `ADMIN_PHONE`.
2. Entre en `/admin` para ver los usuarios y ajustar los planes.

## Copias de seguridad

Todo está en el volumen `/data`. Programe una copia periódica de ese volumen (Coolify permite copias a un almacenamiento S3, o puede copiar la carpeta del volumen desde el VPS).

## Problemas habituales

- **"unable to open database file" al arrancar:** el volumen `/data` no deja escribir al usuario del contenedor (id 10001). Pasa si se monta una carpeta del servidor en lugar de un volumen. Use un volumen, o dé permisos: `chown -R 10001:10001 /ruta/de/la/carpeta`.
- **No aparece el panel de administración:** `ADMIN_PHONE` debe coincidir con el móvil de la cuenta, solo con números (por ejemplo `600123456`). Tras cambiarla hay que volver a desplegar.
- **La hora no cuadra:** revise la variable `TZ`.

## Pendiente para más adelante

- Cobro automático de las suscripciones (por ejemplo con Stripe).
- Recuperación de clave sin pasar por el administrador (por SMS o correo).
- Avisos push cuando un pago se retrasa.
- Acceso por código SMS en lugar de clave (necesita un proveedor de SMS de pago).
