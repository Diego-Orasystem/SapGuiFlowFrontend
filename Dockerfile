# Etapa 1: Construcción de la aplicación Angular
FROM node:18-alpine AS build

# Establecer el directorio de trabajo
WORKDIR /app

# Copiar archivos de configuración de dependencias
COPY package*.json ./

# Instalar todas las dependencias (incluyendo devDependencies para el build)
RUN npm ci

# Copiar el código fuente
COPY . .

# Construir la aplicación para producción
RUN npm run build

# Limpiar devDependencies después del build para reducir el tamaño
RUN npm prune --production

# Etapa 2: Servir la aplicación con nginx
FROM nginx:alpine

# Copiar la configuración personalizada de nginx
COPY nginx.conf /etc/nginx/nginx.conf

# Eliminar la configuración por defecto de nginx
RUN rm -f /etc/nginx/conf.d/default.conf

# Copiar los archivos construidos desde la etapa anterior
COPY --from=build /app/dist/sap-gui-flow-ui /usr/share/nginx/html

# Verificar que los archivos se copiaron correctamente
RUN ls -la /usr/share/nginx/html

# Exponer el puerto 80
EXPOSE 80

# Comando por defecto para ejecutar nginx
CMD ["nginx", "-g", "daemon off;"] 