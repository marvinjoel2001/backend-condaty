require("dotenv").config();
const jsonServer = require("json-server");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const admin = require("firebase-admin");

// Usar directamente el archivo de credenciales para desarrollo
let serviceAccount;
if (process.env.NODE_ENV === "production") {
  serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      : undefined,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
  };
} else {
  // En desarrollo, usa el archivo JSON directamente
  serviceAccount = require("./condaty-e5229-firebase-adminsdk-fbsvc-6de6e2d206.json");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:
    process.env.FIREBASE_DATABASE_URL ||
    "https://condaty-e5229-default-rtdb.firebaseio.com",
  storageBucket:
    process.env.FIREBASE_STORAGE_BUCKET || "condaty-e5229.appspot.com",
});

const db = admin.database();
const bucket = admin.storage().bucket();
const server = jsonServer.create();
const middlewares = jsonServer.defaults({
  static: "public",
});

const SECRET_KEY = process.env.JWT_SECRET || "your-secret-key";

// Configuración de multer para memoria
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten imágenes"));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

// Función para subir archivos a Firebase Storage
async function uploadFileToFirebase(file) {
  try {
    const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${
      file.originalname
    }`;
    const fileUpload = bucket.file(`images/${fileName}`);

    const blobStream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
      },
    });

    return new Promise((resolve, reject) => {
      blobStream.on("error", (error) => reject(error));

      blobStream.on("finish", async () => {
        try {
          await fileUpload.makePublic();
          const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileUpload.name}`;
          resolve(publicUrl);
        } catch (error) {
          reject(error);
        }
      });

      blobStream.end(file.buffer);
    });
  } catch (error) {
    console.error("Error uploading file:", error);
    throw error;
  }
}

server.use(middlewares);
server.use(jsonServer.bodyParser);

// Login con Firebase
server.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const usersRef = db.ref("users");
    const snapshot = await usersRef
      .orderByChild("email")
      .equalTo(email)
      .once("value");
    const users = snapshot.val();

    if (users) {
      const userId = Object.keys(users)[0];
      const user = users[userId];

      if (user.password === password) {
        const token = jwt.sign({ userId, email: user.email }, SECRET_KEY, {
          expiresIn: "1h",
        });

        res.json({
          token,
          user: {
            id: userId,
            email: user.email,
            name: user.name,
            condominio: user.condominio,
          },
        });
      } else {
        res.status(401).json({ message: "Email o contraseña incorrectos" });
      }
    } else {
      res.status(401).json({ message: "Email o contraseña incorrectos" });
    }
  } catch (error) {
    res.status(500).json({ message: "Error en el servidor" });
  }
});

server.post("/auth/register", async (req, res) => {
  try {
    const { email, password, name, condominio } = req.body;

    const usersRef = db.ref("users");
    const snapshot = await usersRef
      .orderByChild("email")
      .equalTo(email)
      .once("value");

    if (snapshot.val()) {
      return res.status(400).json({ message: "El email ya está registrado" });
    }

    const newUser = {
      id: Date.now(),
      email,
      password,
      name,
      condominio,
      createdAt: new Date().toISOString(),
    };

    await usersRef.push(newUser);

    const token = jwt.sign({ userId: newUser.id, email }, SECRET_KEY, {
      expiresIn: "1h",
    });

    res.status(201).json({
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        condominio: newUser.condominio,
      },
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ message: "Error al crear el usuario" });
  }
});

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

// Productos con Firebase y Storage
server.post(
  "/products",
  authMiddleware,
  upload.array("images", 5),
  async (req, res) => {
    try {
      let productData;
      try {
        productData = JSON.parse(req.body.productData);
      } catch (e) {
        return res.status(400).json({ error: "Invalid product data" });
      }

      // Subir imágenes a Firebase Storage
      const imageUrls = [];
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          const imageUrl = await uploadFileToFirebase(file);
          imageUrls.push(imageUrl);
        }
      }

      const newProduct = {
        id: Date.now(),
        name: productData.name || "",
        description: productData.description || "",
        price: Number(productData.price) || 0,
        category: productData.category || "",
        condominio: productData.condominio || "",
        sellerId: productData.sellerId || null,
        images: imageUrls,
        createdAt: new Date().toISOString(),
      };

      const productsRef = db.ref("products");
      await productsRef.push(newProduct);

      res.json(newProduct);
    } catch (error) {
      console.error("Error creating product:", error);
      res.status(500).json({ error: "Error al crear el producto" });
    }
  }
);

server.get("/products", async (req, res) => {
  try {
    const snapshot = await db.ref("products").once("value");
    const products = snapshot.val();
    res.json(products ? Object.values(products) : []);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los productos" });
  }
});

server.put(
  "/products/:id",
  authMiddleware,
  upload.array("images", 5),
  async (req, res) => {
    try {
      const { id } = req.params;
      let productData;

      try {
        productData = JSON.parse(req.body.productData);
      } catch (e) {
        return res.status(400).json({ error: "Invalid product data" });
      }

      const productsRef = db.ref("products");
      const snapshot = await productsRef
        .orderByChild("id")
        .equalTo(parseInt(id))
        .once("value");
      const products = snapshot.val();

      if (!products) {
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      const productKey = Object.keys(products)[0];
      const existingProduct = products[productKey];

      // Subir nuevas imágenes si existen
      let imageUrls = existingProduct.images || [];
      if (req.files && req.files.length > 0) {
        imageUrls = [];
        for (const file of req.files) {
          const imageUrl = await uploadFileToFirebase(file);
          imageUrls.push(imageUrl);
        }
      }

      const updatedProduct = {
        ...existingProduct,
        name: productData.name || existingProduct.name,
        description: productData.description || existingProduct.description,
        price: Number(productData.price) || existingProduct.price,
        category: productData.category || existingProduct.category,
        condominio: productData.condominio || existingProduct.condominio,
        sellerId: productData.sellerId || existingProduct.sellerId,
        images: imageUrls,
        updatedAt: new Date().toISOString(),
      };

      await productsRef.child(productKey).update(updatedProduct);
      res.json(updatedProduct);
    } catch (error) {
      console.error("Error updating product:", error);
      res.status(500).json({ error: "Error al actualizar el producto" });
    }
  }
);

server.delete("/products/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const productsRef = db.ref("products");
    const snapshot = await productsRef
      .orderByChild("id")
      .equalTo(parseInt(id))
      .once("value");
    const products = snapshot.val();

    if (!products) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    const productKey = Object.keys(products)[0];
    await productsRef.child(productKey).remove();
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({ error: "Error al eliminar el producto" });
  }
});

server.post("/orders", authMiddleware, async (req, res) => {
  try {
    const orderData = req.body;
    const newOrder = {
      ...orderData,
      id: Date.now(),
      status: orderData.status || "pending",
      date: orderData.date || new Date().toISOString().split("T")[0],
      products: orderData.products || [],
      total: Number(orderData.total) || 0,
    };

    await db.ref("orders").push(newOrder);
    res.json(newOrder);
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ error: "Error al crear la orden" });
  }
});

server.get("/orders/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const snapshot = await db
      .ref("orders")
      .orderByChild("userId")
      .equalTo(parseInt(userId))
      .once("value");
    const orders = snapshot.val();
    res.json(orders ? Object.values(orders) : []);
  } catch (error) {
    console.error("Error fetching user orders:", error);
    res.status(500).json({ error: "Error al obtener las órdenes" });
  }
});

server.put("/orders/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const ordersRef = db.ref("orders");
    const snapshot = await ordersRef
      .orderByChild("id")
      .equalTo(parseInt(id))
      .once("value");
    const orders = snapshot.val();

    if (!orders) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    const orderKey = Object.keys(orders)[0];
    const existingOrder = orders[orderKey];

    const updatedOrder = {
      ...existingOrder,
      ...updateData,
      id: parseInt(id),
    };

    await ordersRef.child(orderKey).update(updatedOrder);
    res.json(updatedOrder);
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({ error: "Error al actualizar la orden" });
  }
});

server.delete("/orders/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const ordersRef = db.ref("orders");
    const snapshot = await ordersRef
      .orderByChild("id")
      .equalTo(parseInt(id))
      .once("value");
    const orders = snapshot.val();

    if (!orders) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    const orderKey = Object.keys(orders)[0];
    await ordersRef.child(orderKey).remove();
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({ error: "Error al eliminar la orden" });
  }
});

server.get("/categories", async (req, res) => {
  try {
    const snapshot = await db.ref("categories").once("value");
    const categories = snapshot.val();
    res.json(categories ? Object.values(categories) : []);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: "Error al obtener las categorías" });
  }
});

server.get("/products/search", async (req, res) => {
  try {
    const { q, category } = req.query;
    const snapshot = await db.ref("products").once("value");
    let products = snapshot.val() ? Object.values(snapshot.val()) : [];

    if (q) {
      products = products.filter(
        (product) =>
          product.name.toLowerCase().includes(q.toLowerCase()) ||
          product.description.toLowerCase().includes(q.toLowerCase())
      );
    }

    if (category) {
      products = products.filter(
        (product) => product.category.toLowerCase() === category.toLowerCase()
      );
    }

    res.json(products);
  } catch (error) {
    console.error("Error searching products:", error);
    res.status(500).json({ error: "Error al buscar productos" });
  }
});

server.get("/products/condominio/:condominio", async (req, res) => {
  try {
    const { condominio } = req.params;
    const snapshot = await db
      .ref("products")
      .orderByChild("condominio")
      .equalTo(condominio)
      .once("value");
    const products = snapshot.val();
    res.json(products ? Object.values(products) : []);
  } catch (error) {
    console.error("Error fetching condominium products:", error);
    res
      .status(500)
      .json({ error: "Error al obtener los productos del condominio" });
  }
});

// Middleware de autenticación para rutas no públicas
server.use(/^(?!\/auth).*$/, authMiddleware);

// Configuración del servidor
if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
  });
}

module.exports = server;
