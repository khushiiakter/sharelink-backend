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

    // Get all links – if query param "email" is provided, filter by userEmail.
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
        const result = await linksCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.json({ message: "Link deleted successfully", result });
      } catch (error) {
        res.status(500).json({ message: "Failed to delete link", error });
      }
    });

    app.put("/links/:id", async (req, res) => {
      const { id } = req.params;
      const updatedLink = req.body;
    
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ success: false, message: "Invalid task ID." });
      }
    
      try {
        const result = await linksCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedLink }
        );
    
        if (result.modifiedCount === 0) {
          return res.status(404).send({ success: false, message: "Link not found or no changes made." });
        }
    
        res.send({ success: true, message: "Link updated successfully." });
      } catch (error) {
        console.error("Error updating link:", error);
        res.status(500).send({ success: false, message: "Internal Server Error" });
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

    // GET /links/:id – renders the shareable link page.
    // Public links are visible to anyone; for private links, the correct password must be provided via ?password=...
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
          return res.send(`
            <html>
              <head>
                <title>Access Denied</title>
                <style>
                  body {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    background-color: #f8d7da;
                    font-family: Arial, sans-serif;
                  }
                  .message {
                    text-align: center;
                    padding: 20px;
                    background: white;
                    border: 1px solid #721c24;
                    border-radius: 10px;
                    box-shadow: 0px 4px 8px rgba(0, 0, 0, 0.1);
                  }
                  h1 {
                    color: #721c24;
                  }
                  p {
                    color: #721c24;
                  }
                </style>
              </head>
              <body>
                <div class="message">
                  <h1>Access Denied</h1>
                  <p>You are not authorized to view this page.</p>
                </div>
              </body>
            </html>
          `);
        }

        // Increment access count
        await linksCollection.updateOne(
          { _id: new ObjectId(id) },
          { $inc: { accessCount: 1 } }
        );

        // Render a simple HTML page to preview the file and provide a download option.
        const fileUrl = link.fileUrl;
        const ext = path.extname(fileUrl).toLowerCase();
        let html = `<html><head><title>${link.title}</title></head><body>`;
        html += ``;

        if ([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"].includes(ext)) {
          // For images, show preview
          html += `<p style="display: flex; justify-content: center;  "><a href="${fileUrl}"  download>Download </a></p>`;
          html += `<div style="display: flex; justify-content: center;  ">
    <img src="${fileUrl}" alt="${link.title}" style="width: 80%; height: auto;"/>
  </div>`;
        } else if (ext === ".pdf") {
          // For PDF files, embed preview in an iframe
          html += `<iframe src="${fileUrl}" style="width:100%; height:600px;" frameborder="0"></iframe>`;
          html += `<p><a href="${fileUrl}" download>Download PDF</a></p>`;
        } else if ([".doc", ".docx"].includes(ext)) {
          // For Word documents, use Google Docs Viewer
          html += `<iframe src="https://docs.google.com/gview?url=${encodeURIComponent(
            fileUrl
          )}&embedded=true" style="width:100%; height:600px;" frameborder="0"></iframe>`;
          html += `<p><a href="${fileUrl}" download>Download Document</a></p>`;
        } else if (
          [".txt", ".md", ".json", ".js", ".html", ".css"].includes(ext)
        ) {
          // For text files, display content
          const filePath = path.join(__dirname, fileUrl);
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, "utf8");
            html += `<pre>${content}</pre>`;
          } else {
            html += `<p>File not found on server.</p>`;
          }
        } else {
          // For other file types, provide a download link
          html += `<p><a href="${fileUrl}" download>Download File</a></p>`;
        }

        html += `</body></html>`;
        res.send(html);
      } catch (error) {
        console.error(error);
        res.status(500).send("Error retrieving link");
      }
    });

    // Create a new link with file upload
    app.post("/links", upload.single("file"), async (req, res) => {
      try {
        const { userId, userEmail, title, visibility, password, expiration } =
          req.body;
        if (!userId || !req.file) {
          return res
            .status(400)
            .json({ message: "User ID and file are required" });
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
        res.status(201).json({
          message: "Link created successfully",
          id: result.insertedId,
        });
      } catch (error) {
        res.status(500).json({ message: "Failed to create link", error });
      }
    });

    // (Optional) Ping to check connection
    await db.command({ ping: 1 });
    console.log("Pinged your deployment. Connected to MongoDB!");
  } finally {
    // Do not close the client so that our server stays connected.
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("ShareLink is running");
});

app.listen(port, () => {
  console.log(`ShareLink is sitting on port ${port}`);
});
