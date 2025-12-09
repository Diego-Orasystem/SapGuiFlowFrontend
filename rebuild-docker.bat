@echo off
echo Deteniendo contenedores existentes...
docker-compose down

echo Eliminando imagen antigua...
docker rmi sap-gui-flow-frontend_sap-gui-flow-frontend 2>nul

echo Reconstruyendo imagen con los cambios...
docker-compose build --no-cache

echo Levantando contenedor...
docker-compose up -d

echo Verificando estado...
docker-compose ps

echo Ver logs con: docker-compose logs -f
echo Listo! La aplicacion deberia estar disponible en http://localhost
pause

