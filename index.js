const express = require("express");
const app = express();
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require('mongodb');

require("dotenv").config();

const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());



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