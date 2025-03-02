const express = require("express");
const app = express();
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

require("dotenv").config();

const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());
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
    cb(null, Date.now() + path.extname(file.originalname)); // Unique filename
  },
});

const upload = multer({ storage });


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.7xkdi.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const usersCollection = client.db("sharelinkDb").collection("users");
    const linksCollection = client.db("sharelinkDb").collection("links");


    app.post("/users", async (req, res) => {
        const { _id, email, name, photo } = req.body;
        const existingUser = await usersCollection.findOne({ email });
  
        if (!existingUser) {
          const result = await usersCollection.insertOne({
            _id,
            email,
            name,
            photo,
            timestamp: new Date().toLocaleDateString(),
          });
          res.send(result);
        } else{
          res.send({ message: "User already exists" });
        }
      });

      app.get("/links", async (req, res) => {
        const email = req.query.email;
  
        let result;
  
        if (email) {
          const query = { userEmail: email };
          result = await linksCollection.find(query).toArray();
        } else {
          result = await linksCollection.find().toArray();
        }
  
        res.send(result);
      });

      app.post("/links", upload.single("file"), async (req, res) => {
        try {
          const { userId,userEmail, title, visibility, password, expiration } = req.body;
  
          if (!userId || !req.file) {
            return res.status(400).json({ message: "User ID and file are required" });
          }
  
          const fileUrl = `/uploads/${req.file.filename}`;
  
          const newLink = {
            title,
            userId,
            fileUrl,
            userEmail,
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
  
     
  
      app.delete("/links/:id", async (req, res) => {
        try {
          const { id } = req.params;
          const link = await linksCollection.findOne({ _id: new ObjectId(id) });
  
          if (!link) return res.status(404).json({ message: "Link not found" });
  
          // Delete file from server
          if (link.fileUrl) {
            fs.unlinkSync(path.join(__dirname, link.fileUrl));
          }
  
          const result = await linksCollection.deleteOne({ _id: new ObjectId(id) });
          res.json({ message: "Link deleted successfully", result });
        } catch (error) {
          res.status(500).json({ message: "Failed to delete link", error });
        }
      });
      
      
      // Create a new link
     
      // Get a specific link (handles private links with password check)
      // app.get("/links/:id", async (req, res) => {
      //   try {
      //     const { id } = req.params;
      //     const { password } = req.query;
      
      //     const link = await linksCollection.findOne({ _id: new ObjectId(id) });
      
      //     if (!link) return res.status(404).json({ message: "Link not found" });
      
      //     // Handle expiration
      //     if (link.expiration && new Date(link.expiration) < new Date()) {
      //       return res.status(410).json({ message: "This link has expired" });
      //     }
      
      //     // Handle private link access
      //     if (link.visibility === "private" && link.password !== password) {
      //       return res.status(403).json({ message: "Incorrect password" });
      //     }
      
      //     // Increment access count
      //     await linksCollection.updateOne({ _id: new ObjectId(id) }, { $inc: { accessCount: 1 } });
      
      //     res.json(link);
      //   } catch (error) {
      //     res.status(500).json({ message: "Failed to retrieve link", error });
      //   }
      // });
      
      // Update a link
      app.put("/links/:id", async (req, res) => {
        try {
          const { id } = req.params;
          const { url, visibility, password, expiration } = req.body;
      
          const updatedLink = {
            url,
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
      
      

      // app.delete("/links/:id", async (req, res) => {
      //   const { id } = req.params;
      //   const result = await linksCollection.deleteOne({ _id: new ObjectId(id) });
      //   res.send(result);
      // });

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
     
  
      
     
      
     
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
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