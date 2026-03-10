# Bot de Discord para puntos y roles (Dofus Unity)

Bot minimalista en Node.js + discord.js + JSON local (`data.json`).
No usa dashboard web, frontend, Express ni base de datos externa.

## Que hace

- Lee mensajes en un unico canal (`CHANNEL_ID_PARTICIPACION`).
- Detecta keywords: `#encargo`, `#mazmorra`, `#ayuda`, `#rookie`, `#sorteo`, `#armada`.
- Suma puntos y guarda historial en `data.json`.
- Asigna rol automatico de progreso por puntos historicos.
- Asigna roles temporales de Top 3 mensual al ejecutar `!reset-mensual`.
- Mantiene comandos:
  - `!ranking`
  - `!ranking total`
  - `!puntos`
  - `!puntos @usuario`
  - `!reset-mensual`

## Requisitos

- Node.js 18 o superior
- Un bot creado en Discord Developer Portal

## Instalacion

```bash
npm install
```

## Configuracion

1. Copia `.env.example` como `.env`.
2. Rellena todos los IDs reales.

Variables:

- `DISCORD_TOKEN`
- `PREFIX`
- `CHANNEL_ID_PARTICIPACION`
- `ADMIN_USER_IDS`
- `ROLE_ID_INICIADO`
- `ROLE_ID_MIEMBRO`
- `ROLE_ID_AVENTURERO`
- `ROLE_ID_VANGUARDIA`
- `ROLE_ID_CAMPEON`
- `ROLE_ID_LEYENDA`
- `ROLE_ID_PALADIN_DEL_MES`
- `ROLE_ID_HEROE_DEL_MES`
- `ROLE_ID_GUERRERO_DEL_MES`
- `PROTECTED_ROLE_IDS`

## Intents y permisos necesarios

### Intents del bot

- `Guilds`
- `GuildMembers`
- `GuildMessages`
- `MessageContent`

En Discord Developer Portal, activa **Server Members Intent** para que el bot pueda gestionar roles.

### Permisos del bot en el servidor

- Ver canales
- Leer mensajes
- Leer historial de mensajes
- Enviar mensajes
- Gestionar roles

Importante: el rol del bot debe estar por encima de los roles que va a asignar/quitar.

## Ejecucion

```bash
npm start
```

Si inicio correctamente:

```txt
Bot conectado como TuBot#1234
```

## Reglas de puntos

- `#encargo`: autor +8, mencionados +8, `#armada` +2 autor
- `#mazmorra`: autor +5, mencionados +5, `#armada` +2 autor
- `#ayuda`: autor +4, mencionados +4, `#armada` +2 autor
- `#rookie`: autor +6, mencionados +6, `#armada` +2 autor
- `#sorteo`: autor +4, mencionados +0

## Validaciones

- Ignora bots
- Ignora mensajes fuera de `CHANNEL_ID_PARTICIPACION`
- Solo una keyword principal por mensaje
- Rechaza si hay mas de una keyword principal
- `#rookie` y `#sorteo` requieren al menos una mencion valida
- `#encargo`, `#mazmorra` y `#ayuda` permiten registros en solitario
- Deduplica menciones repetidas
- No cuenta auto-menciones
- No cuenta menciones a bots
- No reprocesa un `message_id` ya registrado
- Editar un mensaje no vuelve a sumar puntos

## Roles automaticos por puntos historicos

El bot usa **total historico** para asignar un unico rol de progreso:

- 0-49: `ROLE_ID_INICIADO`
- 50-149: `ROLE_ID_MIEMBRO`
- 150-299: `ROLE_ID_AVENTURERO`
- 300-599: `ROLE_ID_VANGUARDIA`
- 600-999: `ROLE_ID_CAMPEON`
- 1000+: `ROLE_ID_LEYENDA`

Reglas:

- Solo deja 1 rol de progreso activo por usuario.
- Si sube de tramo, quita roles de progreso anteriores y asigna el nuevo.
- No toca roles manuales o especiales fuera de esos IDs.

### Roles protegidos

Si un usuario tiene algun rol listado en `PROTECTED_ROLE_IDS`:

- Sigue sumando puntos normal.
- Sigue apareciendo en ranking y puntos.
- El bot **no le modifica** roles de progreso historico.

## Roles temporales Top 3 mensual

Al ejecutar `!reset-mensual`, el bot:

1. Calcula Top 3 con `monthly_points`.
2. Quita roles mensuales anteriores.
3. Asigna:
   - Top 1 -> `ROLE_ID_PALADIN_DEL_MES`
   - Top 2 -> `ROLE_ID_HEROE_DEL_MES`
   - Top 3 -> `ROLE_ID_GUERRERO_DEL_MES`
4. Guarda snapshots del mes.
5. Reinicia `monthly_points` a 0.

Estos roles mensuales pueden coexistir con roles protegidos y roles manuales.

## Persistencia

`data.json` se crea automaticamente y guarda:

- `users`
- `activity_logs`
- `monthly_snapshots`
- `monthly_resets`
- `monthly_role_holders`

## Archivos principales

- `index.js`: logica del bot (puntos, comandos, roles, validaciones)
- `.env.example`: plantilla de configuracion
- `data.json`: almacenamiento local
- `package.json`: dependencias y script de inicio
