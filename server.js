const jsonServer = require("json-server");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const server = jsonServer.create();
const router = jsonServer.router("db.json");
const middlewares = jsonServer.defaults({
  static: "public", // Servir archivos estáticos desde la carpeta public
});

const SECRET_KEY = "your-secret-key";
const UPLOAD_DIRECTORY = "public/images";
const cors = require("cors");


// Agrega la configuración de CORS antes de los middlewares
server.use(cors({
  origin: '*',
  credentials: true,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  allowedHeaders: ['Content-Type', 'Authorization']
}));

server.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // Permitir todos los orígenes
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header("Access-Control-Allow-Credentials", "true"); // Si no necesitas autenticación basada en cookies, elimínalo
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");

  // Manejar las peticiones preflight OPTIONS
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});


// Asegurar que el directorio de uploads existe
if (!fs.existsSync(UPLOAD_DIRECTORY)) {
  fs.mkdirSync(UPLOAD_DIRECTORY, { recursive: true });
}

// Configurar multer para el manejo de archivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIRECTORY);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    // Validar tipos de archivo
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten imágenes"));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB límite
  },
});

server.use(middlewares);
server.use(jsonServer.bodyParser);

// Autenticación - mantiene compatibilidad con integraciones existentes
server.post("/auth/login", (req, res) => {
  const { email, password } = req.body;
  const db = router.db;
  const user = db.get("users").find({ email, password }).value();

  if (user) {
    const token = jwt.sign({ userId: user.id, email: user.email }, SECRET_KEY, {
      expiresIn: "1h",
    });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        condominio: user.condominio,
      },
    });
  } else {
    res.status(401).json({ message: "Email o contraseña incorrectos" });
  }
});

// Middleware de autenticación - mantiene compatibilidad
const authMiddleware = (req, res, next) => {
  if (req.method === "GET") {
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(" ")[1];
    try {
      const verified = jwt.verify(token, SECRET_KEY);
      req.user = verified;
      next();
    } catch (err) {
      res.status(401).json({ message: "Token inválido" });
    }
  } else {
    res.status(401).json({ message: "Se requiere token de autorización" });
  }
};

// Manejo de productos con imágenes
server.post(
  "/products",
  authMiddleware,
  upload.array("images", 5),
  (req, res) => {
    try {
      const db = router.db;
      let productData;

      try {
        productData = JSON.parse(req.body.productData);
        console.log("Received product data:", productData);
      } catch (e) {
        console.error("Error parsing productData:", e, req.body.productData);
        return res.status(400).json({ error: "Invalid product data" });
      }

      // Mantener compatibilidad con integraciones existentes
      const newProduct = {
        id: Date.now(),
        name: productData.name || "",
        description: productData.description || "",
        price: Number(productData.price) || 0,
        category: productData.category || "",
        condominio: productData.condominio || "",
        sellerId: productData.sellerId || null,
        images: req.files
          ? req.files.map((file) => `images/${file.filename}`)
          : [],
        createdAt: new Date().toISOString(),
      };

      // Guardar en la base de datos
      db.get("products").push(newProduct).write();

      res.json(newProduct);
    } catch (error) {
      console.error("Error creating product:", error);
      res.status(500).json({ error: "Error al crear el producto" });
    }
  }
);

// Actualización de productos
server.put(
  "/products/:id",
  authMiddleware,
  upload.array("images", 5),
  (req, res) => {
    try {
      const db = router.db;
      const { id } = req.params;
      let productData;

      try {
        productData = JSON.parse(req.body.productData);
      } catch (e) {
        return res.status(400).json({ error: "Invalid product data" });
      }

      const existingProduct = db
        .get("products")
        .find({ id: parseInt(id) })
        .value();

      if (!existingProduct) {
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      // Manejar imágenes
      let imagesPaths = existingProduct.images || [];
      if (req.files && req.files.length > 0) {
        // Eliminar imágenes antiguas
        existingProduct.images?.forEach((imagePath) => {
          const fullPath = path.join(process.cwd(), "public", imagePath);
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
          }
        });

        imagesPaths = req.files.map((file) => `images/${file.filename}`);
      }

      // Mantener compatibilidad con integraciones existentes
      const updatedProduct = {
        ...existingProduct,
        name: productData.name || existingProduct.name,
        description: productData.description || existingProduct.description,
        price: Number(productData.price) || existingProduct.price,
        category: productData.category || existingProduct.category,
        condominio: productData.condominio || existingProduct.condominio,
        sellerId: productData.sellerId || existingProduct.sellerId,
        images: imagesPaths,
        updatedAt: new Date().toISOString(),
      };

      db.get("products")
        .find({ id: parseInt(id) })
        .assign(updatedProduct)
        .write();

      res.json(updatedProduct);
    } catch (error) {
      console.error("Error updating product:", error);
      res.status(500).json({ error: "Error al actualizar el producto" });
    }
  }
);

// Eliminar producto
server.delete("/products/:id", authMiddleware, (req, res) => {
  try {
    const db = router.db;
    const { id } = req.params;

    const product = db
      .get("products")
      .find({ id: parseInt(id) })
      .value();
    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    // Eliminar imágenes asociadas
    product.images?.forEach((imagePath) => {
      const fullPath = path.join(process.cwd(), "public", imagePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    });

    db.get("products")
      .remove({ id: parseInt(id) })
      .write();

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({ error: "Error al eliminar el producto" });
  }
});
// Manejo de órdenes
server.post("/orders", authMiddleware, (req, res) => {
  try {
    const db = router.db;
    const orderData = req.body;

    const newOrder = {
      ...orderData,
      id: Date.now(),
      status: orderData.status || "pending",
      date: orderData.date || new Date().toISOString().split('T')[0],
      products: orderData.products || [],
      total: Number(orderData.total) || 0,
    };

    db.get("orders").push(newOrder).write();
    res.json(newOrder);
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ error: "Error al crear la orden" });
  }
});

// Obtener órdenes por usuario
server.get("/orders/user/:userId", (req, res) => {
  try {
    const db = router.db;
    const { userId } = req.params;
    
    const orders = db
      .get("orders")
      .filter({ userId: parseInt(userId) })
      .value();

    res.json(orders);
  } catch (error) {
    console.error("Error fetching user orders:", error);
    res.status(500).json({ error: "Error al obtener las órdenes" });
  }
});

// Actualizar estado de orden
server.put("/orders/:id", authMiddleware, (req, res) => {
  try {
    const db = router.db;
    const { id } = req.params;
    const updateData = req.body;

    const existingOrder = db
      .get("orders")
      .find({ id: parseInt(id) })
      .value();

    if (!existingOrder) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    const updatedOrder = {
      ...existingOrder,
      ...updateData,
      id: parseInt(id),
    };

    db.get("orders")
      .find({ id: parseInt(id) })
      .assign(updatedOrder)
      .write();

    res.json(updatedOrder);
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({ error: "Error al actualizar la orden" });
  }
});

// Eliminar orden
server.delete("/orders/:id", authMiddleware, (req, res) => {
  try {
    const db = router.db;
    const { id } = req.params;

    const order = db
      .get("orders")
      .find({ id: parseInt(id) })
      .value();

    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    db.get("orders")
      .remove({ id: parseInt(id) })
      .write();

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({ error: "Error al eliminar la orden" });
  }
});

// Endpoints para categorías
server.get("/categories", (req, res) => {
  try {
    const db = router.db;
    const categories = db.get("categories").value();
    res.json(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: "Error al obtener las categorías" });
  }
});

// Búsqueda de productos
server.get("/products/search", (req, res) => {
  try {
    const db = router.db;
    const { q, category } = req.query;
    
    let products = db.get("products").value();

    if (q) {
      products = products.filter(product => 
        product.name.toLowerCase().includes(q.toLowerCase()) ||
        product.description.toLowerCase().includes(q.toLowerCase())
      );
    }

    if (category) {
      products = products.filter(product => 
        product.category.toLowerCase() === category.toLowerCase()
      );
    }

    res.json(products);
  } catch (error) {
    console.error("Error searching products:", error);
    res.status(500).json({ error: "Error al buscar productos" });
  }
});

// Productos por condominio
server.get("/products/condominio/:condominio", (req, res) => {
  try {
    const db = router.db;
    const { condominio } = req.params;
    
    const products = db
      .get("products")
      .filter({ condominio })
      .value();

    res.json(products);
  } catch (error) {
    console.error("Error fetching condominium products:", error);
    res.status(500).json({ error: "Error al obtener los productos del condominio" });
  }
});

// Rutas existentes
server.use(/^(?!\/auth).*$/, authMiddleware);
server.use(router);

// Iniciar servidor
server.listen(3000, () => {
  console.log("JSON Server está corriendo en http://localhost:3000");
});
