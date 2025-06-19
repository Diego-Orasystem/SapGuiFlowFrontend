# Despliegue con Docker - SAP GUI Flow Frontend

Este documento explica cómo desplegar la aplicación SAP GUI Flow Frontend utilizando Docker.

## Prerrequisitos

- Docker instalado en el sistema
- Docker Compose instalado
- Al menos 2GB de RAM disponible
- Puerto 80 disponible en el sistema

## Archivos de Docker

- `Dockerfile`: Configuración multi-stage para construir y servir la aplicación
- `docker-compose.yml`: Orquestación de servicios
- `nginx.conf`: Configuración optimizada de nginx para Angular SPA
- `.dockerignore`: Archivos excluidos del contexto de Docker
- `deploy.sh` / `deploy.bat`: Scripts de despliegue automatizado

## Despliegue Rápido

### Opción 1: Usando los scripts de despliegue

**En Linux/Mac:**
```bash
chmod +x deploy.sh
./deploy.sh
```

**En Windows:**
```cmd
deploy.bat
```

### Opción 2: Comandos manuales

```bash
# Construir y levantar los servicios
docker-compose up --build -d

# Verificar el estado
docker-compose ps

# Ver logs
docker-compose logs -f
```

## Comandos Útiles

### Gestión de contenedores
```bash
# Detener servicios
docker-compose down

# Reiniciar servicios
docker-compose restart

# Ver logs en tiempo real
docker-compose logs -f

# Ver logs de las últimas 100 líneas
docker-compose logs --tail=100

# Acceder al contenedor
docker exec -it sap-gui-flow-ui sh
```

### Limpieza del sistema
```bash
# Eliminar contenedores detenidos
docker container prune

# Eliminar imágenes no utilizadas
docker image prune

# Limpieza completa (cuidado!)
docker system prune -a
```

## Configuración

### Cambiar el puerto
Para cambiar el puerto de la aplicación, edita el archivo `docker-compose.yml`:

```yaml
ports:
  - "8080:80"  # Cambia 8080 por el puerto deseado
```

### Variables de entorno
Puedes agregar variables de entorno en el archivo `docker-compose.yml`:

```yaml
environment:
  - NODE_ENV=production
  - API_URL=http://tu-backend-url
```

### Configuración de nginx
La configuración de nginx está optimizada para:
- Aplicaciones Angular SPA
- Compresión gzip
- Caché de archivos estáticos
- Headers de seguridad
- Soporte para Monaco Editor

## Solución de Problemas

### La aplicación no carga
1. Verifica que el contenedor esté ejecutándose: `docker-compose ps`
2. Revisa los logs: `docker-compose logs`
3. Verifica que el puerto 80 esté disponible

### Error de construcción
1. Asegúrate de tener suficiente espacio en disco
2. Verifica que Docker tenga acceso a internet para descargar dependencias
3. Limpia el caché de Docker: `docker builder prune`

### Problemas de permisos (Linux)
```bash
sudo usermod -aG docker $USER
# Luego reinicia la sesión
```

## Arquitectura del Contenedor

El Dockerfile utiliza un enfoque multi-stage:

1. **Stage 1 (build)**: 
   - Usa Node.js 18 Alpine
   - Instala dependencias
   - Construye la aplicación Angular

2. **Stage 2 (runtime)**:
   - Usa nginx Alpine (imagen ligera)
   - Copia los archivos construidos
   - Configura nginx para SPA

## Monitoreo

### Verificar salud del contenedor
```bash
# Estado de los contenedores
docker-compose ps

# Uso de recursos
docker stats sap-gui-flow-ui

# Información detallada
docker inspect sap-gui-flow-ui
```

### Logs estructurados
Los logs de nginx están configurados para incluir:
- IP del cliente
- Timestamp
- Método y URL de la petición
- Código de respuesta
- User agent

## Backup y Restauración

### Crear backup de la imagen
```bash
docker save -o sap-gui-flow-backup.tar sap-gui-flow-frontend_sap-gui-flow-frontend
```

### Restaurar desde backup
```bash
docker load -i sap-gui-flow-backup.tar
```

## Acceso a la Aplicación

Una vez desplegada, la aplicación estará disponible en:
- **URL**: http://localhost (o el puerto configurado)
- **Logs**: `docker-compose logs -f`
- **Estado**: `docker-compose ps`

## Notas Importantes

- La aplicación se construye en modo producción
- Los archivos estáticos tienen caché de 1 año
- Los archivos JSON no tienen caché para permitir actualizaciones dinámicas
- El contenedor se reinicia automáticamente si falla
- Nginx está configurado con headers de seguridad

## Soporte

Para problemas específicos del despliegue:
1. Revisa los logs del contenedor
2. Verifica la configuración de red
3. Asegúrate de que todos los puertos estén disponibles 