const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
// Serve static files from the uploads folder
app.use("/uploads", express.static("uploads"));

// Multer configuration for file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Use a unique filename: timestamp + original extension
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// MongoDB connection string from .env
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.7xkdi.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db("sharelinkDb");
    const usersCollection = db.collection("users");
    const linksCollection = db.collection("links");

    // ---------- USER ROUTES ----------

    app.post("/users", async (req, res) => {
      const { _id, email, name, photo } = req.body;
      const existingUser = await usersCollection.findOne({ email });
      if (!existingUser) {
        const result = await usersCollection.insertOne({
          email,
          name,
          photo,
          timestamp: new Date().toLocaleDateString(),
        });
        res.send(result);
      } else {
        res.send({ message: "User already exists" });
      }
    });

    // ---------- LINK ROUTES ----------

    // Get all links – if a query parameter "email" is provided, filter by userEmail.
    app.get("/links", async (req, res) => {
      try {
        const email = req.query.email;
        let query = {};
        if (email) {
          query = { userEmail: email };
        }
        const links = await linksCollection.find(query).toArray();
        res.send(links);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch links", error });
      }
    });

    // Create a new link with file upload
    app.post("/links", upload.single("file"), async (req, res) => {
      try {
        const { userId, userEmail, title, visibility, password, expiration } = req.body;
        if (!userId || !req.file) {
          return res.status(400).json({ message: "User ID and file are required" });
        }
        const fileUrl = `/uploads/${req.file.filename}`;

        const newLink = {
          title,
          userId,
          userEmail,
          fileUrl,
          visibility: visibility || "public",
          password: visibility === "private" ? password : null,
          expiration: expiration ? new Date(expiration) : null,
          createdAt: new Date().toLocaleDateString(),
          accessCount: 0,
        };

        const result = await linksCollection.insertOne(newLink);
        res.status(201).json({ message: "Link created successfully", id: result.insertedId });
      } catch (error) {
        res.status(500).json({ message: "Failed to create link", error });
      }
    });

    // Delete a link (and delete its file)
    app.delete("/links/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const link = await linksCollection.findOne({ _id: new ObjectId(id) });
        if (!link) return res.status(404).json({ message: "Link not found" });

        // Delete file from server if exists
        if (link.fileUrl) {
          const filePath = path.join(__dirname, link.fileUrl);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
        const result = await linksCollection.deleteOne({ _id: new ObjectId(id) });
        res.json({ message: "Link deleted successfully", result });
      } catch (error) {
        res.status(500).json({ message: "Failed to delete link", error });
      }
    });

    // Update a link's metadata (for example, visibility, password, expiration)
    app.put("/links/:id", async (req, res) => {
      try {
        const { id } = req.params;
        // In update, we assume no file update – only metadata changes.
        const { visibility, password, expiration } = req.body;
        const updatedLink = {
          visibility,
          password: visibility === "private" ? password : null,
          expiration: expiration ? new Date(expiration) : null,
        };
        const result = await linksCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedLink }
        );
        if (result.modifiedCount === 0) {
          return res.status(404).json({ message: "No link found to update" });
        }
        res.json({ message: "Link updated successfully" });
      } catch (error) {
        res.status(500).json({ message: "Failed to update link", error });
      }
    });

    // Get link analytics (access count)
    app.get("/analytics/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const link = await linksCollection.findOne({ _id: new ObjectId(id) });
        if (!link) return res.status(404).json({ message: "Link not found" });
        res.json({ accessCount: link.accessCount });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch analytics", error });
      }
    });

    // GET /links/:id – this endpoint renders the shareable link page.
    // If the link is public, anyone can see it; if private, a query parameter ?password=... must match.
    app.get("/links/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { password } = req.query;
        const link = await linksCollection.findOne({ _id: new ObjectId(id) });
        if (!link) return res.status(404).send("Link not found");

        // Check expiration
        if (link.expiration && new Date(link.expiration) < new Date()) {
          return res.status(410).send("This link has expired");
        }

        // If private, check password
        if (link.visibility === "private" && link.password !== password) {
          return res.status(403).send("Incorrect password");
        }

        // Increment access count
        await linksCollection.updateOne({ _id: new ObjectId(id) }, { $inc: { accessCount: 1 } });

        // Render a simple HTML page for preview/download.
        const fileUrl = link.fileUrl; // e.g. "/uploads/1634567890123.png"
        const ext = path.extname(fileUrl).toLowerCase();
        let html = `<html><head><title>${link.title}</title></head><body>`;
        html += `<h1>${link.title}</h1>`;

        // If image, show preview.
        if ([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"].includes(ext)) {
          html += `<img src="${fileUrl}" alt="${link.title}" style="max-width:100%;"/>`;
        }
        // For text files, display content.
        else if ([".txt", ".md", ".json", ".js", ".html", ".css"].includes(ext)) {
          const filePath = path.join(__dirname, fileUrl);
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, "utf8");
            html += `<pre>${content}</pre>`;
          } else {
            html += `<p>File not found on server.</p>`;
          }
        } else {
          // For other files, provide a download link.
          html += `<p><a href="${fileUrl}" download>Download File</a></p>`;
        }
        html += `</body></html>`;
        res.send(html);
      } catch (error) {
        console.error(error);
        res.status(500).send("Error retrieving link");
      }
    });

    // Send a ping to confirm a successful connection (optional)
    await db.command({ ping: 1 });
    console.log("Pinged your deployment. Connected to MongoDB!");
  } finally {
    // Do not close the client so that our server stays connected.
	 // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("ShareLink is running");
});

app.listen(port, () => {
  console.log(`ShareLink is sitting on port ${port}`);
});
