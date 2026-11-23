# KLYP Alquileres

PWA para que propietarios lleven la cuenta de sus alquileres desde el móvil: pagos, impagos por inmueble, facturas de suministros y contacto de cada inquilino.

## Qué incluye

| Dirección | Qué es |
|---|---|
| `/` | Landing con acceso y planes |
| `/app` | La app del propietario (PWA instalable) |
| `/admin` | Panel de administración: usuarios, sus inmuebles, plan y límites, facturas de suministros por usuario y correo SMTP |
| `/healthz` | Comprobación de que el servidor responde |

- **Servidor:** `server.py`, Python 3 sin dependencias externas (no hay `pip install`).
- **Datos:** SQLite en `DATA_DIR/klyp.db`; PDF de las facturas de suministros en `DATA_DIR/uploads`. Todo lo que hay que conservar está en esa carpeta.
- **Acceso:** móvil + clave. La sesión queda abierta un año en el dispositivo.
- **Planes:** Gratis, Básico y Pro, con máximo de inmuebles y de personas invitadas. Los nombres, precios y límites se cambian en `/admin`. El plan de cada usuario lo asigna el administrador a mano: **no hay cobro automático**.

## Inquilinos, IPC y facturas de suministros

- **Inquilinos por fechas:** cada inmueble guarda una lista de contratos (inquilino, teléfono, renta, fecha de inicio y de fin). Con «Cambiar de inquilino» el anterior queda cerrado la víspera y conserva sus pagos y deudas. Las fechas de dos inquilinos no pueden pisarse. Si uno sale y otro entra dentro del mismo mes, la renta de ese mes se reparte por días (por ejemplo, sale el 15 de mayo: paga 15/31 de la renta; el nuevo paga los 16 días restantes y su día de cobro ese mes es el día que entra). En la ficha, «Corregir el importe de un mes» permite poner otra cantidad a mano.
- **Subida del IPC:** se apunta el porcentaje y la fecha desde la que aplica (al dar de alta el inmueble o después, en la ficha). La renta sube sola desde la mensualidad de ese mes; los meses anteriores no cambian. Pasada la fecha, la ficha vuelve a mostrar «Sin subida de IPC programada» para apuntar la del año siguiente.
- **Facturas de suministros:** solo en los inmuebles con la casilla «Necesito facturas de suministros». Se sube el PDF o se hacen fotos al papel, una por página; las fotos se convierten en un PDF en el propio móvil (máximo 5 MB) con tipo (luz, agua u otro con texto libre), importe y fecha. La factura se asigna al inquilino que estaba en el inmueble en esa fecha y queda **pendiente de pago** hasta que se marca como pagada; cuenta en Impagos.
- **Envío por WhatsApp o correo:** tras guardar, «WhatsApp» y «Correo» abren el mensaje ya escrito, con un enlace al PDF, para el teléfono o el correo del inquilino; solo hay que pulsar Enviar. «Enviar el PDF como archivo» usa el menú de compartir del móvil para adjuntar el documento de verdad. No es un envío sin intervención: eso exige la API de WhatsApp Business de Meta o un servidor de correo.
- **Correo automático (SMTP):** si el administrador configura en `/admin` el servidor de correo, al guardar una factura se envía sola al correo del inquilino con el PDF adjunto (hay una casilla, marcada por defecto, para no enviarla). En la lista, «Correo» la envía o reenvía directamente; si falla, la factura queda marcada con «Correo no enviado» y el motivo. Sin SMTP configurado, «Correo» abre el correo del móvil con el mensaje escrito.
- **Seguimiento por inmueble:** en Facturas se puede filtrar por inmueble y ver lo pendiente, lo facturado en el año por tipo y lo cobrado. La ficha del inmueble muestra el mismo resumen.
- **Enlace del PDF:** `/factura/<clave>.pdf` se abre sin iniciar sesión, para que el inquilino pueda verlo. La clave es aleatoria (128 bits); quien tenga el enlace puede ver esa factura.

## Impagos y acuerdos de pago

- **Impagos por persona:** la pestaña agrupa las deudas por inquilino, no por casa. Si en una casa un inquilino debe y el siguiente no, solo aparece el que debe, aunque ya no viva allí.
- **Acuerdo de pago:** con un inquilino que debe meses anteriores o facturas, «Hacer un acuerdo de pago» recoge esa deuda (se puede cambiar la cantidad) y pide cuánto pagará al mes en total. Lo que pase de la renta va a la deuda: debe 3.000 €, paga 400 € de renta y acuerdan 600 € al mes, así que van 200 € a la deuda durante 15 meses. Si el inquilino ya no vive allí, todo lo que pague va a la deuda.
- La renta del mes en curso no entra en el acuerdo: se sigue cobrando aparte en Pagos.
- Los meses y facturas incluidos dejan de salir sueltos y pasan a «En acuerdo de pago». Los pagos del acuerdo se anotan en la pantalla del acuerdo; la app avisa si va retrasado en las cuotas, y se puede marcar como no cumplido (la deuda que queda sigue en Impagos). Cuando se paga entero, esos meses y facturas pasan a «Pagado con el acuerdo».
- «Enviar el acuerdo por WhatsApp» manda al inquilino las condiciones por escrito.

## Administración de usuarios

En `/admin`, la tabla de usuarios muestra de cada uno: alta, último acceso, inmuebles dados de alta frente a su máximo, ayudantes, plan, si tiene activadas las facturas de suministros y los demás apartados.

- **Ver** (columna Inmuebles) muestra sus inmuebles: nombre, dirección, inquilino actual y si usa facturas.
- **Límite de inmuebles:** cada plan tiene su máximo (se cambia en «Planes y límites»). Además, a un usuario concreto se le puede poner un límite propio desde «Ver», que manda sobre el del plan. Bajar el límite no borra inmuebles: solo impide añadir más.
- **Facturas de suministros:** «Desactivar» quita a ese usuario la pestaña Facturas y la casilla «Necesito facturas de suministros». Sus facturas no se borran y vuelven a verse si se activa otra vez.

## Permisos por usuario

Hay tres apartados: **Pagos e impagos**, **Facturas de suministros** e **Inmuebles e inquilinos**.

- **El propietario** elige, para cada persona que invita, si en cada apartado «no lo ve», «solo puede ver» o «puede ver y anotar», y puede cambiarlo después en **Cuenta**. Así uno puede revisar los pagos y otro subir las facturas.
- **El administrador**, en `/admin`, puede quitar apartados enteros a cualquier usuario registrado. Ese usuario deja de ver la pestaña y sus funciones, tanto en sus alquileres como en los de quien le haya invitado.

El servidor comprueba los permisos en cada petición; no basta con ocultar la pestaña.

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

## Configurar el correo (SMTP)

En `/admin`, apartado **Correo para enviar las facturas (SMTP)**: servidor, puerto, seguridad, usuario, contraseña, dirección y nombre del remitente y, si quiere, una dirección para las respuestas. Después pulse **Enviar prueba** para comprobarlo.

| Proveedor | Servidor | Puerto | Seguridad |
|---|---|---|---|
| Gmail / Google Workspace | `smtp.gmail.com` | 587 | STARTTLS, con una «contraseña de aplicación» de Google |
| Outlook / Microsoft 365 | `smtp.office365.com` | 587 | STARTTLS |
| La mayoría de hostings | el que indique su proveedor | 465 o 587 | SSL/TLS o STARTTLS |

- La contraseña se guarda en la base de datos (`/data/klyp.db`) tal cual, porque el servidor la necesita para enviar. Proteja el volumen `/data` y sus copias de seguridad, y use una contraseña de aplicación o una cuenta solo para esto.
- En el VPS, algunos proveedores bloquean el puerto 25; use 587 o 465.
- Para que los correos no acaben en «no deseado», el dominio del remitente debe tener SPF y DKIM configurados con su proveedor de correo.

## Crear un administrador con correo y clave

Además de `ADMIN_PHONE`, se puede crear una cuenta de administrador desde la consola, en la carpeta del proyecto:

```bash
python server.py crear-admin correo@ejemplo.com suclave
```

Esa cuenta entra en `/admin` con el correo y la clave. Si el correo ya existe, el comando le cambia la clave. En Docker: `docker compose exec app python server.py crear-admin correo@ejemplo.com suclave` (el nombre del servicio puede variar).

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
- Envío de las facturas por WhatsApp sin intervención (API de WhatsApp Business de Meta).
- Acceso por código SMS en lugar de clave (necesita un proveedor de SMS de pago).
