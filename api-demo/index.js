/**
 * API de demonstração: "Luminárias Inteligentes"
 * -------------------------------------------------
 * Objetivo: praticar no Postman os conceitos de uma API REST.
 *
 *  - CRUD completo (GET, POST, PUT, PATCH, DELETE)
 *  - Filtros por query string   -> GET /devices?city=Lisboa&status=fault
 *  - Busca por id via params    -> GET /devices/:id
 *  - Upload de arquivo           -> POST /devices/:id/attachments (multipart/form-data)
 *  - Rotas protegidas por token -> header "Authorization: Bearer <token>"
 *      * sem token / token inválido  -> 401 Unauthorized
 *      * token válido sem permissão  -> 403 Forbidden
 *
 * Os dados ficam salvos localmente em ./data/devices.json
 * (são criados automaticamente na primeira execução).
 *
 * Como rodar:
 *   npm install
 *   npm start            -> http://localhost:3000
 *   Swagger              -> http://localhost:3000/docs
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yaml");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "devices.json");
const ATTACH_FILE = path.join(__dirname, "data", "attachments.json");
const UPLOAD_DIR = path.join(__dirname, "data", "uploads");

app.use(express.json());

// Documentação Swagger (OpenAPI) em http://localhost:3000/docs
// O contrato fica em ./openapi.yaml e também é servido cru em /openapi.yaml e /openapi.json
// (dá para importar direto no Postman: Import -> Link -> http://localhost:3000/openapi.json)
const openapiText = fs.readFileSync(path.join(__dirname, "openapi.yaml"), "utf8");
const openapiDoc = YAML.parse(openapiText);
app.get("/openapi.yaml", (req, res) => res.type("text/yaml").send(openapiText));
app.get("/openapi.json", (req, res) => res.json(openapiDoc));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiDoc, {
  customSiteTitle: "API Demo - Swagger",
  swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
}));

// ---------------------------------------------------------------------------
// 1. "Banco de dados" local em arquivo JSON
// ---------------------------------------------------------------------------

const SEED = [
  { id: 1, name: "LUM-LIS-0001", city: "Lisboa", country: "PT", type: "luminaria", status: "on", dimLevel: 80, firmware: "2.4.1", lastSeen: "2026-11-12T08:15:00Z" },
  { id: 2, name: "LUM-LIS-0002", city: "Lisboa", country: "PT", type: "luminaria", status: "fault", dimLevel: 0, firmware: "2.3.9", lastSeen: "2026-11-11T22:40:00Z" },
  { id: 3, name: "LUM-POR-0001", city: "Porto", country: "PT", type: "luminaria", status: "off", dimLevel: 0, firmware: "2.4.1", lastSeen: "2026-11-12T07:58:00Z" },
  { id: 4, name: "SEN-POR-0001", city: "Porto", country: "PT", type: "sensor", status: "on", dimLevel: null, firmware: "1.1.0", lastSeen: "2026-11-12T08:10:00Z" },
  { id: 5, name: "LUM-MAD-0001", city: "Madrid", country: "ES", type: "luminaria", status: "on", dimLevel: 60, firmware: "2.4.1", lastSeen: "2026-11-12T08:12:00Z" },
  { id: 6, name: "LUM-MAD-0002", city: "Madrid", country: "ES", type: "luminaria", status: "fault", dimLevel: 0, firmware: "2.2.0", lastSeen: "2026-11-10T19:05:00Z" },
  { id: 7, name: "LUM-BRU-0001", city: "Bruxelas", country: "BE", type: "luminaria", status: "on", dimLevel: 100, firmware: "2.4.1", lastSeen: "2026-11-12T08:14:00Z" },
  { id: 8, name: "SEN-BRU-0001", city: "Bruxelas", country: "BE", type: "sensor", status: "off", dimLevel: null, firmware: "1.0.3", lastSeen: "2026-11-12T06:30:00Z" },
];

function loadDevices() {
  if (!fs.existsSync(DATA_FILE)) saveDevices(SEED);
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function saveDevices(devices) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  // Escreve num arquivo temporário e renomeia: evita arquivo corrompido se o processo cair.
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(devices, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// ---------------------------------------------------------------------------
// 2. Autenticação e autorização (tokens fixos, só para demonstração)
// ---------------------------------------------------------------------------

// Em produção os tokens viriam de um servidor OAuth2 / base de dados.
const TOKENS = {
  "token-leitor-123": { user: "joao.leitor", role: "viewer" },
  "token-admin-456": { user: "maria.admin", role: "admin" },
};

/**
 * Middleware de AUTENTICAÇÃO: "quem é você?"
 * Falhou -> 401 Unauthorized
 */
function authenticate(req, res, next) {
  const header = req.get("Authorization");

  if (!header) {
    res.set("WWW-Authenticate", 'Bearer realm="api-demo"');
    return res.status(401).json(error(401, "MISSING_TOKEN", "Header Authorization ausente. Envie: Authorization: Bearer <token>"));
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    res.set("WWW-Authenticate", 'Bearer realm="api-demo", error="invalid_request"');
    return res.status(401).json(error(401, "MALFORMED_TOKEN", "Formato inválido. O esperado é: Bearer <token>"));
  }

  const identity = TOKENS[token];
  if (!identity) {
    res.set("WWW-Authenticate", 'Bearer realm="api-demo", error="invalid_token"');
    return res.status(401).json(error(401, "INVALID_TOKEN", "Token inválido ou expirado."));
  }

  req.user = identity; // disponível para as próximas funções
  next();
}

/**
 * Middleware de AUTORIZAÇÃO: "você pode fazer isto?"
 * Falhou -> 403 Forbidden (sabemos quem é, mas não tem permissão)
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json(
        error(403, "FORBIDDEN", `O perfil '${req.user.role}' não tem permissão. Perfis permitidos: ${allowedRoles.join(", ")}.`)
      );
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// 3. Utilitários
// ---------------------------------------------------------------------------

function error(status, code, message, details) {
  return { error: { status, code, message, ...(details ? { details } : {}) }, requestId: req_id() };
}

function req_id() {
  return crypto.randomUUID();
}

const VALID_STATUS = ["on", "off", "fault"];
const VALID_TYPES = ["luminaria", "sensor"];

/** Valida o corpo de um dispositivo. `partial=true` é usado no PATCH. */
function validateDevice(body, partial = false) {
  const errors = [];
  const required = ["name", "city", "country", "type", "status"];

  if (!partial) {
    for (const field of required) {
      if (body[field] === undefined || body[field] === "") errors.push({ field, issue: "obrigatório" });
    }
  }
  if (body.status !== undefined && !VALID_STATUS.includes(body.status))
    errors.push({ field: "status", issue: `deve ser um de: ${VALID_STATUS.join(", ")}` });
  if (body.type !== undefined && !VALID_TYPES.includes(body.type))
    errors.push({ field: "type", issue: `deve ser um de: ${VALID_TYPES.join(", ")}` });
  if (body.dimLevel !== undefined && body.dimLevel !== null &&
      (typeof body.dimLevel !== "number" || body.dimLevel < 0 || body.dimLevel > 100))
    errors.push({ field: "dimLevel", issue: "deve ser um número entre 0 e 100" });
  if (body.country !== undefined && !/^[A-Z]{2}$/.test(body.country))
    errors.push({ field: "country", issue: "código ISO de 2 letras maiúsculas, ex.: PT" });
  if (body.id !== undefined) errors.push({ field: "id", issue: "não pode ser enviado; é gerado pelo servidor" });

  return errors;
}

/** Converte o :id da URL em número; devolve null se não for válido. */
function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Log simples de cada pedido no terminal (útil para mostrar o "outro lado").
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(`${new Date().toISOString()}  ${req.method.padEnd(6)} ${req.originalUrl}  -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// ---------------------------------------------------------------------------
// 4. Rotas públicas
// ---------------------------------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    name: "API de demonstração: Luminárias Inteligentes",
    docs: "Swagger em /docs (contrato em /openapi.yaml). Collection do Postman em ./postman",
    routes: [
      "GET    /health",
      "GET    /devices?city=&country=&status=&type=&minDim=&q=&sort=&order=&page=&limit=",
      "GET    /devices/:id",
      "POST   /devices",
      "PUT    /devices/:id",
      "PATCH  /devices/:id",
      "DELETE /devices/:id",
      "GET    /cities/:city/devices",
      "POST   /devices/:id/attachments      (multipart/form-data, campo 'file')",
      "GET    /devices/:id/attachments",
      "GET    /attachments/:attachmentId    (download)",
      "DELETE /attachments/:attachmentId",
      "GET    /secure/me                  (qualquer token válido)",
      "GET    /secure/reports/faults      (qualquer token válido)",
      "POST   /secure/devices/:id/reboot  (apenas admin)",
      "DELETE /secure/devices             (apenas admin)",
      "POST   /reset",
    ],
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "UP", time: new Date().toISOString() });
});

/**
 * LISTAR com filtros por QUERY STRING.
 * Exemplos:
 *   /devices?city=Lisboa
 *   /devices?status=fault&country=PT
 *   /devices?type=luminaria&minDim=50&sort=dimLevel&order=desc
 *   /devices?q=MAD
 *   /devices?page=2&limit=3
 */
app.get("/devices", (req, res) => {
  const { city, country, status, type, minDim, q, sort = "id", order = "asc" } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));

  if (status && !VALID_STATUS.includes(status)) {
    return res.status(400).json(error(400, "INVALID_QUERY", `status inválido: '${status}'`, { allowed: VALID_STATUS }));
  }
  if (minDim !== undefined && Number.isNaN(Number(minDim))) {
    return res.status(400).json(error(400, "INVALID_QUERY", "minDim deve ser numérico"));
  }

  let result = loadDevices();

  // Comparações sem diferenciar maiúsculas/minúsculas.
  const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

  if (city) result = result.filter((d) => eq(d.city, city));
  if (country) result = result.filter((d) => eq(d.country, country));
  if (status) result = result.filter((d) => d.status === status);
  if (type) result = result.filter((d) => eq(d.type, type));
  if (minDim !== undefined) result = result.filter((d) => d.dimLevel !== null && d.dimLevel >= Number(minDim));
  if (q) result = result.filter((d) => d.name.toLowerCase().includes(String(q).toLowerCase()));

  const dir = order === "desc" ? -1 : 1;
  result.sort((a, b) => (a[sort] > b[sort] ? dir : a[sort] < b[sort] ? -dir : 0));

  const total = result.length;
  const data = result.slice((page - 1) * limit, page * limit);

  res.set("X-Total-Count", String(total));
  res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    filters: { city, country, status, type, minDim, q, sort, order },
  });
});

/** BUSCAR UM por id via PARAMS: /devices/2 */
app.get("/devices/:id", (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json(error(400, "INVALID_ID", `id inválido: '${req.params.id}'. Deve ser um inteiro positivo.`));

  const device = loadDevices().find((d) => d.id === id);
  if (!device) return res.status(404).json(error(404, "NOT_FOUND", `Dispositivo ${id} não encontrado.`));

  res.json(device);
});

/** Params + query juntos: /cities/Lisboa/devices?status=fault */
app.get("/cities/:city/devices", (req, res) => {
  const { city } = req.params;
  const { status } = req.query;
  let result = loadDevices().filter((d) => d.city.toLowerCase() === city.toLowerCase());
  if (status) result = result.filter((d) => d.status === status);
  res.json({ city, count: result.length, data: result });
});

/** CRIAR: POST /devices com JSON no body -> 201 Created + header Location */
app.post("/devices", (req, res) => {
  const errors = validateDevice(req.body);
  if (errors.length) return res.status(422).json(error(422, "VALIDATION_ERROR", "O corpo do pedido tem campos inválidos.", errors));

  const devices = loadDevices();
  if (devices.some((d) => d.name === req.body.name)) {
    return res.status(409).json(error(409, "CONFLICT", `Já existe um dispositivo com o nome '${req.body.name}'.`));
  }

  const device = {
    id: devices.reduce((max, d) => Math.max(max, d.id), 0) + 1,
    name: req.body.name,
    city: req.body.city,
    country: req.body.country,
    type: req.body.type,
    status: req.body.status,
    dimLevel: req.body.dimLevel ?? (req.body.type === "sensor" ? null : 0),
    firmware: req.body.firmware ?? "1.0.0",
    lastSeen: new Date().toISOString(),
  };

  devices.push(device);
  saveDevices(devices);

  res.status(201).location(`/devices/${device.id}`).json(device);
});

/** SUBSTITUIR: PUT envia o recurso COMPLETO */
app.put("/devices/:id", (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json(error(400, "INVALID_ID", `id inválido: '${req.params.id}'.`));

  const errors = validateDevice(req.body);
  if (errors.length) return res.status(422).json(error(422, "VALIDATION_ERROR", "PUT exige o recurso completo.", errors));

  const devices = loadDevices();
  const idx = devices.findIndex((d) => d.id === id);
  if (idx === -1) return res.status(404).json(error(404, "NOT_FOUND", `Dispositivo ${id} não encontrado.`));

  devices[idx] = {
    id,
    name: req.body.name,
    city: req.body.city,
    country: req.body.country,
    type: req.body.type,
    status: req.body.status,
    dimLevel: req.body.dimLevel ?? null,
    firmware: req.body.firmware ?? devices[idx].firmware,
    lastSeen: new Date().toISOString(),
  };
  saveDevices(devices);
  res.json(devices[idx]);
});

/** ATUALIZAR PARCIALMENTE: PATCH envia só o que muda, ex.: { "dimLevel": 40 } */
app.patch("/devices/:id", (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json(error(400, "INVALID_ID", `id inválido: '${req.params.id}'.`));
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json(error(400, "EMPTY_BODY", "Envie pelo menos um campo para atualizar."));
  }

  const errors = validateDevice(req.body, true);
  if (errors.length) return res.status(422).json(error(422, "VALIDATION_ERROR", "Campos inválidos.", errors));

  const devices = loadDevices();
  const idx = devices.findIndex((d) => d.id === id);
  if (idx === -1) return res.status(404).json(error(404, "NOT_FOUND", `Dispositivo ${id} não encontrado.`));

  // Só aceita campos conhecidos; o resto é ignorado.
  const allowed = ["name", "city", "country", "type", "status", "dimLevel", "firmware"];
  const changes = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));

  devices[idx] = { ...devices[idx], ...changes, id, lastSeen: new Date().toISOString() };
  saveDevices(devices);
  res.json(devices[idx]);
});

/** APAGAR: 204 No Content (sem body) */
app.delete("/devices/:id", (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json(error(400, "INVALID_ID", `id inválido: '${req.params.id}'.`));

  const devices = loadDevices();
  const idx = devices.findIndex((d) => d.id === id);
  if (idx === -1) return res.status(404).json(error(404, "NOT_FOUND", `Dispositivo ${id} não encontrado.`));

  devices.splice(idx, 1);
  saveDevices(devices);
  res.status(204).send();
});

/** Volta os dados ao estado inicial (útil entre demonstrações). */
app.post("/reset", (req, res) => {
  saveDevices(SEED);
  saveAttachments([]);
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  res.json({ message: "Dados restaurados ao estado inicial.", total: SEED.length });
});

// ---------------------------------------------------------------------------
// 4b. Upload de arquivos (multipart/form-data)
// ---------------------------------------------------------------------------
//   POST   /devices/:id/attachments   campo "file" (obrigatório) + "description" (opcional)
//   GET    /devices/:id/attachments   lista os anexos do dispositivo
//   GET    /attachments/:attachmentId baixa o arquivo
//   DELETE /attachments/:attachmentId apaga o anexo
//
//   Sem arquivo / campo com outro nome -> 400
//   Body que não é multipart            -> 415
//   Tipo de arquivo não permitido       -> 415
//   Arquivo maior que 2 MB              -> 413

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "application/pdf": ".pdf",
  "text/csv": ".csv",
  "text/plain": ".txt",
};

// Guarda o arquivo em memória primeiro; só grava em disco depois de validar.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

function loadAttachments() {
  if (!fs.existsSync(ATTACH_FILE)) return [];
  return JSON.parse(fs.readFileSync(ATTACH_FILE, "utf8"));
}

function saveAttachments(list) {
  fs.mkdirSync(path.dirname(ATTACH_FILE), { recursive: true });
  fs.writeFileSync(ATTACH_FILE, JSON.stringify(list, null, 2));
}

/** Roda o multer e traduz os erros dele em respostas HTTP claras. */
function receiveFile(req, res, next) {
  if (!req.is("multipart/form-data")) {
    return res.status(415).json(error(415, "UNSUPPORTED_MEDIA_TYPE",
      "Envie o arquivo como multipart/form-data (no Postman: Body -> form-data, chave 'file' do tipo File)."));
  }
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json(error(413, "PAYLOAD_TOO_LARGE", `Arquivo maior que o limite de ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`));
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json(error(400, "UNEXPECTED_FIELD", "Envie exatamente um arquivo, no campo 'file'."));
    }
    next(err);
  });
}

app.post("/devices/:id/attachments", receiveFile, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json(error(400, "INVALID_ID", `id inválido: '${req.params.id}'.`));
  if (!loadDevices().some((d) => d.id === id)) {
    return res.status(404).json(error(404, "NOT_FOUND", `Dispositivo ${id} não encontrado.`));
  }
  if (!req.file) {
    return res.status(400).json(error(400, "MISSING_FILE", "Nenhum arquivo recebido. Use o campo 'file' do tipo File."));
  }

  const ext = ALLOWED_MIME[req.file.mimetype];
  if (!ext) {
    return res.status(415).json(error(415, "UNSUPPORTED_FILE_TYPE", `Tipo '${req.file.mimetype}' não permitido.`,
      { allowed: Object.keys(ALLOWED_MIME) }));
  }

  const attachment = {
    id: crypto.randomUUID(),
    deviceId: id,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    description: req.body.description || null, // campos de texto do form-data chegam em req.body
    sha256: crypto.createHash("sha256").update(req.file.buffer).digest("hex"),
    uploadedAt: new Date().toISOString(),
  };

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, attachment.id + ext), req.file.buffer);
  const list = loadAttachments();
  list.push(attachment);
  saveAttachments(list);

  res.status(201).location(`/attachments/${attachment.id}`).json(attachment);
});

app.get("/devices/:id/attachments", (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json(error(400, "INVALID_ID", `id inválido: '${req.params.id}'.`));
  const data = loadAttachments().filter((a) => a.deviceId === id);
  res.json({ deviceId: id, count: data.length, data });
});

app.get("/attachments/:attachmentId", (req, res) => {
  const att = loadAttachments().find((a) => a.id === req.params.attachmentId);
  if (!att) return res.status(404).json(error(404, "NOT_FOUND", `Anexo ${req.params.attachmentId} não encontrado.`));
  res.download(path.join(UPLOAD_DIR, att.id + ALLOWED_MIME[att.mimeType]), att.originalName);
});

app.delete("/attachments/:attachmentId", (req, res) => {
  const list = loadAttachments();
  const idx = list.findIndex((a) => a.id === req.params.attachmentId);
  if (idx === -1) return res.status(404).json(error(404, "NOT_FOUND", `Anexo ${req.params.attachmentId} não encontrado.`));
  const [att] = list.splice(idx, 1);
  fs.rmSync(path.join(UPLOAD_DIR, att.id + ALLOWED_MIME[att.mimeType]), { force: true });
  saveAttachments(list);
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// 5. Rotas protegidas
// ---------------------------------------------------------------------------
//   Authorization: Bearer token-leitor-123  -> perfil viewer
//   Authorization: Bearer token-admin-456   -> perfil admin
//
//   Sem header / formato errado / token desconhecido -> 401
//   Token válido mas perfil sem permissão            -> 403

const secure = express.Router();
secure.use(authenticate); // TODAS as rotas abaixo exigem token

/** Qualquer token válido: mostra quem está autenticado. */
secure.get("/me", (req, res) => {
  res.json({ authenticated: true, ...req.user });
});

/** Qualquer token válido: relatório de dispositivos em falha. */
secure.get("/reports/faults", (req, res) => {
  const faults = loadDevices().filter((d) => d.status === "fault");
  const byCountry = faults.reduce((acc, d) => ({ ...acc, [d.country]: (acc[d.country] || 0) + 1 }), {});
  res.json({ generatedBy: req.user.user, totalFaults: faults.length, byCountry, devices: faults });
});

/** Apenas admin: reinicia um dispositivo (viewer recebe 403). */
secure.post("/devices/:id/reboot", authorize("admin"), (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json(error(400, "INVALID_ID", `id inválido: '${req.params.id}'.`));

  const devices = loadDevices();
  const device = devices.find((d) => d.id === id);
  if (!device) return res.status(404).json(error(404, "NOT_FOUND", `Dispositivo ${id} não encontrado.`));

  device.status = "on";
  device.lastSeen = new Date().toISOString();
  saveDevices(devices);
  res.status(202).json({ message: `Reboot do dispositivo ${id} aceito.`, requestedBy: req.user.user, device });
});

/** Apenas admin: apaga TODOS os dispositivos (viewer recebe 403). */
secure.delete("/devices", authorize("admin"), (req, res) => {
  saveDevices([]);
  res.status(204).send();
});

app.use("/secure", secure);

// ---------------------------------------------------------------------------
// 6. Tratamento de erros genérico
// ---------------------------------------------------------------------------

// Rota inexistente -> 404
app.use((req, res) => {
  res.status(404).json(error(404, "ROUTE_NOT_FOUND", `Rota ${req.method} ${req.originalUrl} não existe. Veja GET / para a lista.`));
});

// JSON mal formatado no body -> 400; qualquer outra exceção -> 500
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json(error(400, "INVALID_JSON", "O body não é um JSON válido. Verifique vírgulas e aspas."));
  }
  console.error(err);
  res.status(500).json(error(500, "INTERNAL_ERROR", "Erro inesperado no servidor."));
});

app.listen(PORT, () => {
  loadDevices(); // garante que o arquivo de dados existe
  console.log(`API de demonstração rodando em http://localhost:${PORT}`);
  console.log(`Swagger em http://localhost:${PORT}/docs`);
  console.log(`Dados salvos em ${DATA_FILE}`);
});
