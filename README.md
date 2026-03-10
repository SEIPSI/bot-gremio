# Bot de Discord minimalista para puntos (Dofus Unity)

Este proyecto es solo un bot. No tiene dashboard web, frontend, React, Express ni Postgres.

## Que hace el bot

- Lee mensajes en un unico canal de participacion.
- Detecta keywords (`#encargo`, `#mazmorra`, `#rookie`, `#sorteo`, `#armada`).
- Suma puntos al autor y a usuarios mencionados.
- Guarda todo en `data.json` (sin SQLite).
- Comandos disponibles:
  - `!ranking`
  - `!ranking total`
  - `!puntos`
  - `!puntos @usuario`
  - `!reset-mensual` (solo IDs en `ADMIN_USER_IDS`)

## Requisitos

- Node.js 18 o superior
- Un bot creado en Discord Developer Portal

## 1) Instalar dependencias

En la carpeta del proyecto, abre una terminal y ejecuta:

```bash
npm install
```

## 2) Configurar .env

1. Copia `.env.example` y renombralo a `.env`.
2. Abre `.env` y rellena valores reales.

Ejemplo:

```env
DISCORD_TOKEN=tu_token_real
PREFIX=!
CHANNEL_ID_PARTICIPACION=123456789012345678
ADMIN_USER_IDS=123456789012345678
```

## 3) Ejecutar el bot

```bash
npm start
```

Si todo esta bien, en consola veras algo como:

```txt
Bot conectado como TuBot#1234
```

## 4) Como probar en Discord

### A) Probar registro valido

En el canal configurado en `CHANNEL_ID_PARTICIPACION`:

```txt
#encargo
participantes: @Usuario1 @Usuario2
detalle: prueba
```

Debe responder con puntos del autor y mencionados.

### B) Probar validaciones

- Mandar dos keywords principales en un mensaje (`#encargo #mazmorra`) -> debe rechazar.
- Mandar mensaje sin menciones validas en `#encargo`, `#mazmorra`, `#rookie` o `#sorteo` -> debe rechazar.
- Repetir el mismo mensaje ya procesado (mismo `message_id`) -> no debe volver a sumar.
- Enviar mensajes fuera del canal configurado -> el bot los ignora.

### C) Probar comandos

En cualquier canal donde el bot pueda leer y responder:

```txt
!puntos
!ranking
!ranking total
```

## Reglas de puntos implementadas

- `#encargo`: autor +8, mencionados +8, `#armada` +2 autor
- `#mazmorra`: autor +5, mencionados +5, `#armada` +2 autor
- `#rookie`: autor +6, mencionados +6, `#armada` +2 autor
- `#sorteo`: autor +4, mencionados +0

## Intents usados

Solo estos tres:

- `Guilds`
- `GuildMessages`
- `MessageContent`

## Persistencia JSON

El bot crea `data.json` automaticamente con:

- usuarios
- logs por `message_id`
- snapshots mensuales
- marcador de reset mensual

## Que hace cada archivo

- `package.json`: dependencias y script `npm start`.
- `index.js`: todo el bot (conexion Discord, validaciones, puntos, comandos y persistencia JSON).
- `.env.example`: plantilla de variables de entorno.
- `README.md`: esta guia.