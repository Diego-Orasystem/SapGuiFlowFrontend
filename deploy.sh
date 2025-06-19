#!/bin/bash

# Script de despliegue para SAP GUI Flow Frontend
echo "🚀 Iniciando despliegue de SAP GUI Flow Frontend..."

# Detener y eliminar contenedores existentes
echo "🛑 Deteniendo contenedores existentes..."
docker-compose down

# Eliminar imágenes anteriores (opcional, descomenta si quieres forzar rebuild)
# docker rmi sap-gui-flow-frontend_sap-gui-flow-frontend 2>/dev/null || true

# Construir y levantar los servicios
echo "🔨 Construyendo y levantando servicios..."
docker-compose up --build -d

# Verificar el estado de los contenedores
echo "📊 Verificando estado de los contenedores..."
docker-compose ps

# Mostrar logs en tiempo real (opcional)
echo "📝 Mostrando logs del contenedor..."
docker-compose logs -f --tail=50

echo "✅ Despliegue completado. La aplicación debería estar disponible en http://localhost" 