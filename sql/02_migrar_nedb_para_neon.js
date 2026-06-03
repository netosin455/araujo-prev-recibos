/**
 * Migração NeDB → Neon (PostgreSQL)
 *
 * COMO USAR:
 * 1. Copie os arquivos recibos.db, clientes.db e auditoria.db do servidor
 *    para a pasta sql/ ao lado deste script
 * 2. Configure DATABASE_URL no .env ou exporte a variável:
 *       export DATABASE_URL="postgresql://..."
 * 3. Execute:
 *       node sql/02_migrar_nedb_para_neon.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const fs   = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function lerNedb(arquivo) {
  const caminho = path.join(__dirname, arquivo);
  if (!fs.existsSync(caminho)) {
    console.warn(`⚠️  Arquivo não encontrado: ${caminho} — pulando.`);
    return [];
  }
  return fs.readFileSync(caminho, "utf8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => {
      try { return JSON.parse(l); }
      catch { console.warn("Linha inválida ignorada:", l.slice(0, 80)); return null; }
    })
    .filter(Boolean);
}

async function migrarRecibos(client) {
  const docs = lerNedb("recibos.db");
  console.log(`\n📄 Migrando ${docs.length} recibos...`);
  let ok = 0, skip = 0;

  for (const r of docs) {
    try {
      await client.query(`
        INSERT INTO recibos (
          id, num, nome, cpf, municipio_uf, valor, data,
          emitido_por, complemento, referencia, forma_pagamento,
          escritorio, motivo_pagamento, link_comprovante, timestamp,
          assinatura_govbr, historico_edicoes, deletado_em, deletado_por
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        ON CONFLICT (id) DO NOTHING
      `, [
        r._id,
        r.num               || "",
        r.nome              || "",
        r.cpf               || "",
        r.municipio_uf      || "",
        r.valor             || "",
        r.data              || "",
        r.emitido_por       || "",
        r.complemento       || "",
        r.referencia        || "",
        r.forma_pagamento   || "",
        r.escritorio        || "",
        r.motivo_pagamento  || "",
        r.link_comprovante  || "",
        r.timestamp         || 0,
        r.assinatura_govbr  ? JSON.stringify(r.assinatura_govbr)  : null,
        JSON.stringify(r.historico_edicoes || []),
        r.deletado_em       || null,
        r.deletado_por      || null,
      ]);
      ok++;
    } catch (e) {
      console.error(`  ❌ Recibo ${r._id} (${r.num}): ${e.message}`);
      skip++;
    }
  }
  console.log(`  ✅ ${ok} inseridos, ${skip} erros`);
}

async function migrarClientes(client) {
  const docs = lerNedb("clientes.db");
  console.log(`\n👤 Migrando ${docs.length} clientes...`);
  let ok = 0, skip = 0;

  for (const c of docs) {
    try {
      await client.query(`
        INSERT INTO clientes (
          id, nome, cpf, telefone, endereco, municipio_uf, firma, referencia,
          valor_beneficio, num_beneficios, valor_contrato, num_parcelas, valor_parcela,
          parcelas, parcelas_pagas, parcelas_restantes, valor_pago, valor_restante,
          observacoes, updated_at, created_at, deletado_em, deletado_por
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        ON CONFLICT (id) DO NOTHING
      `, [
        c._id,
        c.nome              || "",
        c.cpf               || "",
        c.telefone          || "",
        c.endereco          || "",
        c.municipio_uf      || "",
        c.firma             || "",
        c.referencia        || "",
        Number(c.valor_beneficio)    || 0,
        Number(c.num_beneficios)     || 0,
        Number(c.valor_contrato)     || 0,
        Number(c.num_parcelas)       || 0,
        Number(c.valor_parcela)      || 0,
        JSON.stringify(c.parcelas    || []),
        Number(c.parcelas_pagas)     || 0,
        Number(c.parcelas_restantes) || 0,
        Number(c.valor_pago)         || 0,
        Number(c.valor_restante)     || 0,
        JSON.stringify(c.observacoes || []),
        c.updated_at  || null,
        c.created_at  || null,
        c.deletado_em || null,
        c.deletado_por || null,
      ]);
      ok++;
    } catch (e) {
      console.error(`  ❌ Cliente ${c._id} (${c.nome}): ${e.message}`);
      skip++;
    }
  }
  console.log(`  ✅ ${ok} inseridos, ${skip} erros`);
}

async function migrarAuditoria(client) {
  const docs = lerNedb("auditoria.db");
  console.log(`\n📋 Migrando ${docs.length} registros de auditoria...`);
  let ok = 0, skip = 0;

  for (const a of docs) {
    try {
      await client.query(`
        INSERT INTO auditoria (id, ts, usuario, role, acao, entidade_id, dados)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (id) DO NOTHING
      `, [
        a._id,
        a.ts           || new Date().toISOString(),
        a.usuario      || "",
        a.role         || "",
        a.acao         || "",
        a.entidade_id  || "",
        JSON.stringify(a.dados || {}),
      ]);
      ok++;
    } catch (e) {
      console.error(`  ❌ Auditoria ${a._id}: ${e.message}`);
      skip++;
    }
  }
  console.log(`  ✅ ${ok} inseridos, ${skip} erros`);
}

async function main() {
  console.log("🚀 Iniciando migração NeDB → Neon...");
  const client = await pool.connect();
  try {
    await migrarRecibos(client);
    await migrarClientes(client);
    await migrarAuditoria(client);
    console.log("\n✅ Migração concluída!");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error("❌ Erro fatal:", e.message);
  process.exit(1);
});
