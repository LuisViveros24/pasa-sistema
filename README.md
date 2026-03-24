# DGSPM — Sistema Integral de Supervisión PASA
### R. Ayuntamiento de Torreón · Dirección de Limpieza

---

## Requisitos

- **Node.js v18, v20, v22 o v24** — descarga en https://nodejs.org (elige la versión LTS)
- Una computadora con macOS, Windows o Linux

> ⚠️ Si tienes **Node.js v24** (como sale en tu Mac) funciona perfecto — se eliminó
> la dependencia `better-sqlite3` que causaba el error de compilación.

---

## Instalación (solo la primera vez)

### 1. Coloca la carpeta del proyecto donde quieras
Por ejemplo:
```
~/Desktop/pasa-sistema/      ← Mac/Linux
C:\DGSPM\pasa-sistema\       ← Windows
```

### 2. Abre una terminal en esa carpeta
- **Mac**: arrastra la carpeta al icono de Terminal, o click derecho → "Nueva terminal en carpeta"
- **Windows**: clic derecho dentro de la carpeta → "Abrir en Terminal"

### 3. Instala las dependencias
```bash
npm install
```
Descarga Express, SQLite y Multer. Solo se hace **una vez**.
No hay módulos nativos — no requiere compiladores ni Xcode.

---

## Cómo iniciar el sistema

```bash
node server.js
```

Verás esto en la terminal:
```
  ╔══════════════════════════════════════════════════════╗
  ║   DGSPM — Sistema Integral PASA · Torreón           ║
  ╠══════════════════════════════════════════════════════╣
  ║   Local  →  http://localhost:3000                   ║
  ║   Red    →  http://192.168.1.X:3000                 ║
  ╚══════════════════════════════════════════════════════╝
```

**Abrir el sistema:**
- En tu Mac/PC → `http://localhost:3000`
- Desde celular o tablet en la misma red WiFi → usa la dirección de Red que aparece

**Detener el servidor:** `Ctrl + C`

---

## Dónde se guardan los datos

| Qué | Dónde |
|-----|-------|
| Base de datos (todos los registros) | `pasa.db` en la raíz del proyecto |
| Fotos subidas | carpeta `uploads/` |

> **Respaldo**: copia el archivo `pasa.db` y la carpeta `uploads/` a donde quieras.

---

## Modo desarrollo (reinicio automático al guardar cambios)

```bash
npm run dev
```

---

## Estructura del proyecto

```
pasa-sistema/
├── server.js           ← inicia el servidor
├── pasa.db             ← base de datos (se crea automáticamente al iniciar)
├── package.json
├── db/
│   └── database.js     ← esquema de tablas SQLite
├── routes/
│   ├── boletas.js
│   ├── diario.js
│   ├── auditorias.js
│   ├── actas.js
│   ├── reuniones.js
│   └── stats.js
├── public/
│   └── index.html      ← el sistema web completo
└── uploads/            ← fotos guardadas aquí
```

---

*Versión 1.1.0 — Compatible Node.js v18–v24 — DGSPM Torreón 2026*
