import { useState, useRef, useEffect } from "react";

const GOOGLE_CLIENT_ID = "447335181295-dnpmatjslushr51c1lcp8l84btkog9ih.apps.googleusercontent.com";
const CONTYME_EMAIL = "Icarmona@contyme.cl";
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
  "profile",
  "email",
].join(" ");

function formatMonto(val) {
  const n = val.replace(/\D/g, "");
  return n ? "$" + parseInt(n).toLocaleString("es-CL") : "";
}
function parseMontoNum(val) {
  return parseInt(val.replace(/\D/g, "") || "0");
}
function fechaHoy() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}

async function crearCarpetaEnDrive(token, nombre, padreId = null) {
  const meta = { name: nombre, mimeType: "application/vnd.google-apps.folder", ...(padreId ? { parents: [padreId] } : {}
