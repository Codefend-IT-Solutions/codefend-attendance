const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
require("dotenv").config();
const app = express();
const http = require("http");
const server = http.createServer(app);

//CORS
app.use(cors());
console.log("Starting server...");
//Project files and routes
const apiRouter = require("./routes");
const connect = require("./config/db");

// Middlewares
app.use(bodyParser.json());
app.use(express.static("public"));
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));

//connect to database
connect();

//Connecting routes
app.use("/api", apiRouter);

//Connect Server
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Your app is running on PORT ${PORT}`);
});
