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
- **Registro:** nombre, correo, móvil y clave. La cuenta queda pendiente hasta que el usuario pulsa el enlace del correo de activación (vale 48 horas). Hace falta tener configurado el correo (SMTP) en `/admin`; sin él, el registro avisa de que no se pueden crear cuentas.
- **Acceso:** correo o móvil, y clave. La sesión queda abierta un año en el dispositivo.
- **Planes:** Gratis, Básico y Pro, con máximo de inmuebles y de personas invitadas. Los nombres, precios y límites se cambian en `/admin`. El plan de cada usuario lo asigna el administrador a mano: **no hay cobro automático**.

## Inquilinos, IPC y facturas de suministros

- **Inquilinos por fechas:** cada inmueble guarda una lista de contratos (inquilino, teléfono, renta, fecha de inicio y de fin). Con «Cambiar de inquilino» el anterior queda cerrado la víspera y conserva sus pagos y deudas. Las fechas de dos inquilinos no pueden pisarse. Si uno sale y otro entra dentro del mismo mes, la renta de ese mes se reparte por días (por ejemplo, sale el 15 de mayo: paga 15/31 de la renta; el nuevo paga los 16 días restantes y su día de cobro ese mes es el día que entra). En la ficha, «Corregir el importe de un mes» permite poner otra cantidad a mano.
- **Subida del IPC:** se apunta el porcentaje y la fecha desde la que aplica (al dar de alta el inmueble o después, en la ficha). La renta sube sola desde la mensualidad de ese mes; los meses anteriores no cambian. Pasada la fecha, la ficha vuelve a mostrar «Sin subida de IPC programada» para apuntar la del año siguiente.
- **Facturas de suministros:** solo en los inmuebles con la casilla «Necesito facturas de suministros». Se sube el PDF o se hacen fotos al papel, una por página; las fotos se convierten en un PDF en el propio móvil (máximo 5 MB) con tipo (luz, agua u otro con texto libre), importe y fecha. La factura se asigna al inquilino que estaba en el inmueble en esa fecha y queda **pendiente de pago** hasta que se marca como pagada; cuenta en Pendiente.
- **Subida en dos pasos:** 1) el documento (PDF o fotos); 2) los datos, con la factura a la vista (al lado en el ordenador, desplegable en el móvil; se muestra con PDF.js, incluido en `public/vendor/pdfjs`) y un botón **Atrás** que conserva lo escrito.
- **Lectura con IA (opcional):** si el administrador la configura en `/admin` → «IA para leer facturas», al pasar al paso 2 la IA lee el PDF y rellena tipo, importe, fecha e inmueble (por la dirección de suministro). El usuario revisa y corrige antes de guardar. Si la IA falla, se rellena a mano.
- **Envío por WhatsApp o correo:** tras guardar, «WhatsApp» y «Correo» abren el mensaje ya escrito, con un enlace al PDF, para el teléfono o el correo del inquilino; solo hay que pulsar Enviar. «Enviar el PDF como archivo» usa el menú de compartir del móvil para adjuntar el documento de verdad. No es un envío sin intervención: eso exige la API de WhatsApp Business de Meta o un servidor de correo.
- **Correo automático (SMTP):** si el administrador configura en `/admin` el servidor de correo, al guardar una factura se envía sola al correo del inquilino con el PDF adjunto (hay una casilla, marcada por defecto, para no enviarla). En la lista, «Correo» la envía o reenvía directamente; si falla, la factura queda marcada con «Correo no enviado» y el motivo. Sin SMTP configurado, «Correo» abre el correo del móvil con el mensaje escrito.
- **Seguimiento por inmueble:** en Facturas se puede filtrar por inmueble y ver lo pendiente, lo facturado en el año por tipo y lo cobrado. La ficha del inmueble muestra el mismo resumen.
- **Enlace del PDF:** `/factura/<clave>.pdf` se abre sin iniciar sesión, para que el inquilino pueda verlo. La clave es aleatoria (128 bits); quien tenga el enlace puede ver esa factura.

## Pantallas y cobros

- **Pestañas:** Inicio · Pendiente · Facturas · Inmuebles · Cuenta.
- **Inicio:** panel con lo cobrado, lo pendiente y lo previsto de **este mes**, **los últimos 3 meses** o **el año en curso**; el cobrado se separa en efectivo y banco. Debajo, lo que falta por cobrar este mes.
- **Cobrar:** se elige el importe (puede ser **parcial**: lo que falta queda pendiente), la fecha (**hoy** u otra) y la forma (**efectivo** o **banco**). Un mes puede tener varios cobros; en la ficha del inmueble se ven todos y se pueden quitar.
- **Contactar** (desde Pendiente o desde la ficha): teléfono, WhatsApp y correo con el mensaje de recordatorio, y el detalle de lo que debe.
- **Ficha del inmueble** (desde Inmuebles): inquilinos, cambio de inquilino, IPC, historial de cobros mes a mes, acuerdos, facturas y datos del inmueble.
- **Tamaño del texto:** botones A− / A+ arriba, o en Cuenta (Pequeño, Normal, Grande, Muy grande). Se guarda en la cuenta del usuario.
- Los cobros de versiones anteriores pasan solos al nuevo sistema, con la forma de pago sin indicar.

## Pendiente y acuerdos de pago

- **Pendiente por persona:** la pestaña agrupa las deudas por inquilino, no por casa. Si en una casa un inquilino debe y el siguiente no, solo aparece el que debe, aunque ya no viva allí.
- **Acuerdo de pago:** con un inquilino que debe meses anteriores o facturas, «Hacer un acuerdo de pago» recoge esa deuda (se puede cambiar la cantidad) y pide cuánto pagará al mes en total. Lo que pase de la renta va a la deuda: debe 3.000 €, paga 400 € de renta y acuerdan 600 € al mes, así que van 200 € a la deuda durante 15 meses. Si el inquilino ya no vive allí, todo lo que pague va a la deuda.
- La renta del mes en curso no entra en el acuerdo: se sigue cobrando aparte, como cualquier mes.
- Los meses y facturas incluidos dejan de salir sueltos y pasan a «En acuerdo de pago». Los pagos del acuerdo se anotan en la pantalla del acuerdo; la app avisa si va retrasado en las cuotas, y se puede marcar como no cumplido (la deuda que queda sigue en Pendiente). Cuando se paga entero, esos meses y facturas pasan a «Pagado con el acuerdo».
- «Enviar el acuerdo por WhatsApp» manda al inquilino las condiciones por escrito.

## Administración de usuarios

En `/admin`, la tabla de usuarios muestra de cada uno: alta, último acceso, inmuebles dados de alta frente a su máximo, ayudantes, plan, si tiene activadas las facturas de suministros y los demás apartados.

- **Ver** (columna Inmuebles) muestra sus inmuebles: nombre, dirección, inquilino actual y si usa facturas.
- **Límite de inmuebles:** cada plan tiene su máximo (se cambia en «Planes y límites»). Además, a un usuario concreto se le puede poner un límite propio desde «Ver», que manda sobre el del plan. Bajar el límite no borra inmuebles: solo impide añadir más.
- **Facturas de suministros:** «Desactivar» quita a ese usuario la pestaña Facturas y la casilla «Necesito facturas de suministros». Sus facturas no se borran y vuelven a verse si se activa otra vez.

## Añadir personas y dar de alta propietarios

- **El propietario**, en Cuenta → **Añadir una persona**: nombre, correo y qué puede ver o anotar en cada apartado. Le llega un correo con un enlace (vale 7 días) para **crear su contraseña** y entrar; si ya tenía cuenta con ese correo, solo tiene que entrar con su clave para aceptar. No hay códigos. Desde la lista se puede reenviar o anular la invitación y cambiar los permisos.
- **El superadmin**, en `/admin` → **Dar de alta un propietario**: nombre, correo y plan. Le llega un correo para crear su contraseña. Hasta entonces aparece como «Sin contraseña todavía», con el botón «Reenviar correo».

## Borrar datos de un usuario (superadmin)

En `/admin`, botón **Ver** del usuario → **Borrar datos**:
- **Empezar de cero:** borra cobros, acuerdos de pago, facturas de suministros (con sus PDF) e importes corregidos. **Se conservan los inmuebles y los inquilinos** (con sus rentas e IPC).
- **Borrar todo:** además borra los inmuebles y los inquilinos.
- **Contar desde:** fecha a partir de la cual cuentan los meses (por ejemplo, 1/1/2027). Los meses anteriores no aparecen ni cuentan como deuda.
- La cuenta, el plan y las personas que le ayudan se mantienen. Para confirmar hay que escribir el correo del usuario. **No se puede deshacer**: haga antes una copia del volumen `/data`.

## Permisos por usuario

Hay tres apartados: **Pagos** (Inicio y Pendiente), **Facturas de suministros** e **Inmuebles e inquilinos**.

- **El propietario** elige, para cada persona que invita, si en cada apartado «no lo ve», «solo puede ver» o «puede ver y anotar», y puede cambiarlo después en **Cuenta**. Así uno puede revisar los pagos y otro subir las facturas.
- **El administrador**, en `/admin`, puede quitar apartados enteros a cualquier usuario registrado. Ese usuario deja de ver la pestaña y sus funciones, tanto en sus alquileres como en los de quien le haya invitado.

El servidor comprueba los permisos en cada petición; no basta con ocultar la pestaña.

## Activación de cuentas

- Al registrarse se envía un correo con el enlace `https://alquileres.klyp.es/app?activar=…`. Al pulsarlo, la cuenta se activa y el usuario entra directamente.
- Si intenta entrar sin haberla activado, la app se lo dice y le ofrece **Enviarme otra vez el correo** (como mucho 5 veces cada 15 minutos). Cada correo nuevo anula el enlace anterior.
- Si alguien se registra y nunca activa la cuenta, puede volver a registrarse con el mismo correo o móvil: la cuenta pendiente se sustituye.
- Si un usuario viene de una invitación, la invitación se acepta al activar la cuenta.
- En `/admin`, las cuentas pendientes aparecen como **Sin activar**, con los botones **Activar** (sin correo, por ejemplo si no le llega) y **Reenviar correo**.
- Las cuentas que ya existían antes de este cambio, y las de administrador creadas con `crear-admin`, quedan activadas.

## Si un usuario olvida su clave

1. El usuario le contacta por el medio indicado en `SUPPORT_CONTACT`.
2. En `/admin`, pulse **Código de recuperación** en la fila de ese usuario. Aparece un código de 8 caracteres, válido 24 horas y de un solo uso.
3. Dígaselo al usuario. Él pulsa «He olvidado mi clave», escribe su correo o su móvil, el código y una clave nueva, y entra directamente (si su cuenta estaba sin activar, queda activada).

Compruebe que quien pide el código es de verdad el titular antes de dárselo. Además, cada usuario puede cambiar su clave desde **Cuenta** si recuerda la actual.

## Variables de entorno

| Variable | Para qué | Valor en Docker |
|---|---|---|
| `PUBLIC_URL` | Dirección pública de la app. Se usa en los enlaces de facturas e invitaciones que se envían por WhatsApp o correo. | `https://alquileres.klyp.es` |
| `ADMIN_PHONE` | Opcional. Móvil (o móviles separados por comas) de quien administra. La cuenta registrada con ese móvil ve `/admin`. El administrador también se puede crear con correo (`crear-admin`). | Opcional |
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

## IA para leer facturas

En `/admin` → **IA para leer facturas**: proveedor, clave API y modelo (vacío = el recomendado), con botón **Probar**, que envía una factura de ejemplo y muestra lo que ha leído.

| Proveedor | Dónde sacar la clave | Modelo recomendado |
|---|---|---|
| Gemini (Google) | Google AI Studio. La suscripción Gemini Pro de la app **no** incluye la API. | `gemini-2.5-flash` |
| ChatGPT (OpenAI) | platform.openai.com | `gpt-4.1-mini` |
| Claude (Anthropic) | console.anthropic.com | `claude-opus-5-5` |

- Cada lectura la cobra el proveedor (normalmente céntimos). La clave se guarda en la base de datos, como la contraseña SMTP.
- Los nombres de modelo de Gemini y ChatGPT cambian con frecuencia: si «Probar» da error de modelo, escriba en «Modelo» uno vigente de la web del proveedor.
- El servidor necesita salida a internet hacia el proveedor elegido (`generativelanguage.googleapis.com`, `api.openai.com` o `api.anthropic.com`).

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

En la zona DNS de `klyp.es`, cree un registro de tipo **A** con nombre `alquileres` que apunte a la IP del VPS de Contabo (y uno **AAAA** si usa IPv6). Compruebe que resuelve antes de desplegar: `nslookup alquileres.klyp.es` debe devolver esa IP. Si no, Coolify no podrá pedir el certificado HTTPS.

### 3. Código

Suba esta carpeta a un repositorio Git (GitHub o GitLab). `.gitignore` ya deja fuera `data/` y `.env`.

### 4. Aplicación en Coolify

1. **New Resource** y elija el repositorio (público, o privado conectando la GitHub App de Coolify).
2. **Rama:** la que tenga la versión a publicar (hoy, `suministros-contratos-permisos`, o `main` cuando se fusione).
3. **Build Pack:** `Dockerfile`.
4. **Ports Exposes:** `3000`.
5. **Domains:** `https://alquileres.klyp.es` (con `https://`). Coolify pide el certificado HTTPS solo.
6. **Environment Variables:** `PUBLIC_URL=https://alquileres.klyp.es` y `SUPPORT_CONTACT` con su forma de contacto (por ejemplo `WhatsApp 600 123 456`).
7. **Persistent Storage:** añada un volumen (Volume Mount) con destino `/data`. **Sin este paso los datos se pierden en cada despliegue.**
8. **Health Check:** ruta `/healthz`, puerto `3000`.
9. Pulse **Deploy**.

### 5. Primer uso

1. En Coolify, abra la pestaña **Terminal** de la aplicación y cree su administrador (use una clave larga):

   ```bash
   python server.py crear-admin su-correo@ejemplo.com SU_CLAVE
   ```

2. Entre en `https://alquileres.klyp.es/admin` con ese correo y esa clave.
3. **Configure el correo (SMTP) antes de nada** y envíese una prueba: sin él nadie puede registrarse. El remitente debe ser una dirección de `klyp.es` (por ejemplo `facturas@klyp.es`), con SPF y DKIM configurados en el DNS de `klyp.es`, para que los correos no acaben en «no deseado».
4. Ajuste los planes y límites. Los propietarios se dan de alta en `https://alquileres.klyp.es/app?registro`.

## Copias de seguridad

Todo está en el volumen `/data`. Programe una copia periódica de ese volumen (Coolify permite copias a un almacenamiento S3, o puede copiar la carpeta del volumen desde el VPS).

## Problemas habituales

- **"unable to open database file" al arrancar:** el volumen `/data` no deja escribir al usuario del contenedor (id 10001). Pasa si se monta una carpeta del servidor en lugar de un volumen. Use un volumen, o dé permisos: `chown -R 10001:10001 /ruta/de/la/carpeta`.
- **No aparece el panel de administración:** entre en `/admin` con la cuenta creada con `crear-admin`. Si usa `ADMIN_PHONE`, debe coincidir con el móvil de la cuenta, solo con números (por ejemplo `600123456`), y tras cambiarla hay que volver a desplegar.
- **El certificado HTTPS no se emite:** el registro DNS de `alquileres.klyp.es` aún no apunta al VPS, o los puertos 80 y 443 están cerrados.
- **Los enlaces de las facturas salen con otra dirección:** revise `PUBLIC_URL`.
- **La hora no cuadra:** revise la variable `TZ`.

## Pendiente para más adelante

- Cobro automático de las suscripciones (por ejemplo con Stripe).
- Recuperación de clave sin pasar por el administrador (por SMS o correo).
- Avisos push cuando un pago se retrasa.
- Envío de las facturas por WhatsApp sin intervención (API de WhatsApp Business de Meta).
- Acceso por código SMS en lugar de clave (necesita un proveedor de SMS de pago).
