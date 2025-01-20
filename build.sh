#!/bin/bash

# Obtener la fecha actual para el tag
DATE=$(date +%Y%m%d_%H%M%S)

# Construir la imagen
docker build -t marvinjoel2001/condaty:latest -t marvinjoel2001/condaty:$DATE .

# Subir ambas versiones al registro
docker push marvinjoel2001/condaty:latest
docker push marvinjoel2001/condaty:$DATE

echo "Imagen subida como marvinjoel2001/condaty:latest y marvinjoel2001/condaty:$DATE"