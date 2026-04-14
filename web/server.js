/* eslint-disable no-console */
const path = require("path");
const express = require("express");

const app = express();

const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";

const webRoot = __dirname;

app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.use(express.static(webRoot, { extensions: ["html"] }));

app.get("/", (_req, res) => {
  res.sendFile(path.join(webRoot, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log("🚀 HFT FPGA Web Demo (Node)");
  console.log(`📡 http://localhost:${PORT}`);
});

