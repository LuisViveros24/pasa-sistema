#!/bin/bash
# Script de arranque del Sistema PASA
# Se ejecuta automáticamente al iniciar sesión

# Cargar nvm para encontrar node
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Directorio del proyecto
cd /Users/viverosmunoz/Desktop/pasa-sistema

# Iniciar el servidor
exec node server.js
