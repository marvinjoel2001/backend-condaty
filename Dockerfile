FROM node:18-alpine

WORKDIR /usr/src/app

# Instalar dependencias necesarias
RUN apk add --no-cache python3 make g++

# Copiar archivos de configuración primero
COPY package*.json ./
COPY condaty-e5229-firebase-adminsdk-fbsvc-6de6e2d206.json ./

# Instalar dependencias
RUN npm install

# Copiar el resto del código
COPY . .

# Exponer el puerto
EXPOSE 3000

# Comando para iniciar el servidor
CMD ["npm", "start"]