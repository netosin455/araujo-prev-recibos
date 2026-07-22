// ============================================================
// services/database.js — NeDB-style helpers sobre PostgreSQL
// ============================================================
const { randomUUID } = require("crypto");
const logger = require("./logger");

const NAO_DELETADO = { deletado_em: { $exists: false } };

const _PG_JSON = {
  recibos:   new Set(["assinatura_govbr", "historico_edicoes"]),
  clientes:  new Set(["parcelas", "observacoes"]),
  auditoria: new Set(["dados"]),
};

// Cache simples em memória com TTL
const cache = new Map();
const CACHE_TTL = 5000;

function cacheKey(table, query, sort) {
  return `${table}:${JSON.stringify(query)}:${JSON.stringify(sort)}`;
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { cache.delete(key); return null; }
  return entry.value;
}

function cacheSet(key, value) { cache.set(key, { value, expires: Date.now() + CACHE_TTL }); }

function cacheClear(table) {
  if (!table) { cache.clear(); return; }
  for (const key of cache.keys()) {
    if (key.startsWith(table + ":")) cache.delete(key);
  }
}

function _rowToDoc(row) {
  if (!row) return null;
  return { ...row, _id: row.id };
}

const _COL = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function _buildWhere(query) {
  const entries = Object.entries(query || {});
  if (!entries.length) return { clause: "", params: [] };
  const parts = [], params = [];
  for (const [key, val] of entries) {
    const col = key === "_id" ? "id" : key;
    if (!_COL.test(col)) continue;
    if (val && typeof val === "object" && "$exists" in val) {
      parts.push(val.$exists ? `${col} IS NOT NULL` : `${col} IS NULL`);
    } else if (val && typeof val === "object") {
      if ("$regex" in val && val.$regex instanceof RegExp) {
        params.push(val.$regex.source);
        const operador = val.$regex.ignoreCase ? "~*" : "~";
        parts.push(`${col} ${operador} $${params.length}`);
      }
      if ("$lt"  in val) { params.push(val.$lt);  parts.push(`${col} < $${params.length}`); }
      if ("$lte" in val) { params.push(val.$lte); parts.push(`${col} <= $${params.length}`); }
      if ("$gte" in val) { params.push(val.$gte); parts.push(`${col} >= $${params.length}`); }
      if ("$gt"  in val) { params.push(val.$gt);  parts.push(`${col} > $${params.length}`); }
    } else {
      params.push(val);
      parts.push(`${col} = $${params.length}`);
    }
  }
  return { clause: " WHERE " + parts.join(" AND "), params };
}

function _buildOrder(sort) {
  if (!sort || !Object.keys(sort).length) return "";
  return " ORDER BY " + Object.entries(sort)
    .filter(([k]) => _COL.test(k === "_id" ? "id" : k))
    .map(([k, v]) => `${k === "_id" ? "id" : k} ${v === -1 ? "DESC" : "ASC"}`)
    .join(", ");
}

function _serializeDoc(table, doc) {
  const jsonFields = _PG_JSON[table] || new Set();
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    out[k] = (v !== null && v !== undefined && typeof v === "object" && jsonFields.has(k))
      ? JSON.stringify(v)
      : v;
  }
  return out;
}

const INDEXES_SQL = [
  `CREATE INDEX IF NOT EXISTS idx_recibos_nome ON recibos (nome)`,
  `CREATE INDEX IF NOT EXISTS idx_recibos_cpf ON recibos (cpf)`,
  `CREATE INDEX IF NOT EXISTS idx_recibos_data ON recibos (data DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_recibos_referencia ON recibos (referencia)`,
  `CREATE INDEX IF NOT EXISTS idx_recibos_escritorio ON recibos (escritorio)`,
  `CREATE INDEX IF NOT EXISTS idx_recibos_deletado_em ON recibos (deletado_em)`,
  `CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes (nome)`,
  `CREATE INDEX IF NOT EXISTS idx_clientes_cpf ON clientes (cpf)`,
  `CREATE INDEX IF NOT EXISTS idx_clientes_deletado_em ON clientes (deletado_em)`,
  `CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria (usuario)`,
  `CREATE INDEX IF NOT EXISTS idx_auditoria_ts ON auditoria (ts DESC)`,
  // Busca do fichário: 2 subconsultas por cliente contra documentos.cliente_cpf
  `CREATE INDEX IF NOT EXISTS idx_documentos_cliente_cpf ON documentos (cliente_cpf) WHERE deletado_em IS NULL`,
];

module.exports = function createDatabase(pgPool) {
  // Cria índices PostgreSQL em background (não bloqueia queries)
  (async () => {
    try {
      for (const sql of INDEXES_SQL) {
        await pgPool.query(sql).catch(() => {});
      }
      logger.info(`[DB] ${INDEXES_SQL.length} índices verificados/criados.`);
    } catch (_) {}
  })();

  async function find(table, query = {}, sort = null) {
    const key = cacheKey(table, query, sort);
    const cached = cacheGet(key);
    if (cached) return cached;
    const { clause, params } = _buildWhere(query);
    const order = _buildOrder(sort);
    const { rows } = await pgPool.query(`SELECT * FROM ${table}${clause}${order}`, params);
    const result = rows.map(_rowToDoc);
    cacheSet(key, result);
    return result;
  }

  async function findOne(table, query = {}) {
    const key = cacheKey(table, query, null);
    const cached = cacheGet(key);
    if (cached) return cached;
    const { clause, params } = _buildWhere(query);
    const { rows } = await pgPool.query(`SELECT * FROM ${table}${clause} LIMIT 1`, params);
    const result = rows[0] ? _rowToDoc(rows[0]) : null;
    cacheSet(key, result);
    return result;
  }

  async function insert(table, doc) {
    const id  = doc._id || randomUUID();
    const raw = _serializeDoc(table, doc);
    const fields = Object.keys(raw).filter(k => k !== "_id" && k !== "id");
    const cols   = ["id", ...fields];
    const vals   = [id, ...fields.map(f => raw[f] ?? null)];
    const ph     = cols.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await pgPool.query(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${ph}) RETURNING *`,
      vals
    );
    cacheClear(table);
    return _rowToDoc(rows[0]);
  }

  async function update(table, query, upd) {
    if (!upd || !Object.keys(upd).length) return;
    const { clause, params } = _buildWhere(query);
    const raw   = _serializeDoc(table, upd);
    const fields = Object.keys(raw).filter(k => k !== "_id" && k !== "id");
    if (!fields.length) return;
    const setParts = fields.map((f, i) => `${f} = $${params.length + i + 1}`);
    const setVals  = fields.map(f => raw[f] ?? null);
    await pgPool.query(
      `UPDATE ${table} SET ${setParts.join(", ")}${clause}`,
      [...params, ...setVals]
    );
    cacheClear(table);
  }

  async function remove(table, query) {
    const { clause, params } = _buildWhere(query);
    await pgPool.query(`DELETE FROM ${table}${clause}`, params);
    cacheClear(table);
  }

  async function count(table, query = {}) {
    const { clause, params } = _buildWhere(query);
    const { rows } = await pgPool.query(`SELECT COUNT(*) FROM ${table}${clause}`, params);
    return parseInt(rows[0].count, 10);
  }

  async function findLimited(table, query = {}, sort = null, limitN = 50) {
    const key = cacheKey(table, query, sort) + `:limit=${limitN}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    const { clause, params } = _buildWhere(query);
    const order = _buildOrder(sort);
    const { rows } = await pgPool.query(
      `SELECT * FROM ${table}${clause}${order} LIMIT ${parseInt(limitN)}`,
      params
    );
    const result = rows.map(_rowToDoc);
    cacheSet(key, result);
    return result;
  }

  return { find, findOne, insert, update, remove, count, findLimited, NAO_DELETADO };
};
