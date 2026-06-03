-- ============================================================
-- Araujo Prev — Criação das tabelas no Neon (PostgreSQL)
-- Execute este script UMA VEZ no painel do Neon (SQL Editor)
-- ============================================================

-- ── RECIBOS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recibos (
  id                TEXT        PRIMARY KEY,          -- _id do NeDB
  num               TEXT        NOT NULL,             -- ex: "0042/2025"
  nome              TEXT        NOT NULL DEFAULT '',
  cpf               TEXT        NOT NULL DEFAULT '',
  municipio_uf      TEXT        NOT NULL DEFAULT '',
  valor             TEXT        NOT NULL DEFAULT '',  -- "1.500,00" (string formatada)
  data              TEXT        NOT NULL DEFAULT '',  -- "DD/MM/YYYY"
  emitido_por       TEXT        NOT NULL DEFAULT '',
  complemento       TEXT        NOT NULL DEFAULT '',
  referencia        TEXT        NOT NULL DEFAULT '',
  forma_pagamento   TEXT        NOT NULL DEFAULT '',
  escritorio        TEXT        NOT NULL DEFAULT '',
  motivo_pagamento  TEXT        NOT NULL DEFAULT '',
  link_comprovante  TEXT        NOT NULL DEFAULT '',
  timestamp         BIGINT      NOT NULL DEFAULT 0,   -- Unix ms
  assinatura_govbr  JSONB,                            -- null ou objeto
  historico_edicoes JSONB       NOT NULL DEFAULT '[]',
  deletado_em       TEXT,                             -- null = ativo
  deletado_por      TEXT
);

CREATE INDEX IF NOT EXISTS idx_recibos_cpf       ON recibos (cpf);
CREATE INDEX IF NOT EXISTS idx_recibos_num       ON recibos (num);
CREATE INDEX IF NOT EXISTS idx_recibos_timestamp ON recibos (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_recibos_deletado  ON recibos (deletado_em) WHERE deletado_em IS NULL;

-- ── CLIENTES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes (
  id                  TEXT        PRIMARY KEY,        -- _id do NeDB
  nome                TEXT        NOT NULL,
  cpf                 TEXT        NOT NULL UNIQUE,
  telefone            TEXT        NOT NULL DEFAULT '',
  endereco            TEXT        NOT NULL DEFAULT '',
  municipio_uf        TEXT        NOT NULL DEFAULT '',
  firma               TEXT        NOT NULL DEFAULT '',
  referencia          TEXT        NOT NULL DEFAULT '',
  valor_beneficio     NUMERIC(12,2) NOT NULL DEFAULT 0,
  num_beneficios      INTEGER     NOT NULL DEFAULT 0,
  valor_contrato      NUMERIC(12,2) NOT NULL DEFAULT 0,
  num_parcelas        INTEGER     NOT NULL DEFAULT 0,
  valor_parcela       NUMERIC(12,2) NOT NULL DEFAULT 0,
  parcelas            JSONB       NOT NULL DEFAULT '[]',
  parcelas_pagas      INTEGER     NOT NULL DEFAULT 0,
  parcelas_restantes  INTEGER     NOT NULL DEFAULT 0,
  valor_pago          NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_restante      NUMERIC(12,2) NOT NULL DEFAULT 0,
  observacoes         JSONB       NOT NULL DEFAULT '[]',
  updated_at          TEXT,
  created_at          TEXT,
  deletado_em         TEXT,
  deletado_por        TEXT
);

CREATE INDEX IF NOT EXISTS idx_clientes_cpf      ON clientes (cpf);
CREATE INDEX IF NOT EXISTS idx_clientes_nome     ON clientes (nome);
CREATE INDEX IF NOT EXISTS idx_clientes_deletado ON clientes (deletado_em) WHERE deletado_em IS NULL;

-- ── AUDITORIA ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auditoria (
  id          TEXT        PRIMARY KEY,                -- _id do NeDB
  ts          TEXT        NOT NULL,                  -- ISO timestamp
  usuario     TEXT        NOT NULL DEFAULT '',
  role        TEXT        NOT NULL DEFAULT '',
  acao        TEXT        NOT NULL DEFAULT '',
  entidade_id TEXT        NOT NULL DEFAULT '',
  dados       JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_auditoria_ts      ON auditoria (ts DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria (usuario);
CREATE INDEX IF NOT EXISTS idx_auditoria_acao    ON auditoria (acao);
