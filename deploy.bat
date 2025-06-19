@echo off
echo 🚀 Iniciando despliegue de SAP GUI Flow Frontend...

echo 🛑 Deteniendo contenedores existentes...
docker-compose down

echo 🔨 Construyendo y levantando servicios...
docker-compose up --build -d

echo 📊 Verificando estado de los contenedores...
docker-compose ps

echo 📝 Mostrando logs del contenedor...
docker-compose logs --tail=50

echo ✅ Despliegue completado. La aplicación debería estar disponible en http://localhost
pause 