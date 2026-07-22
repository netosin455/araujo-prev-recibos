const { describe, it } = require("node:test");
const assert = require("node:assert");

const createDatabase = require("../web/services/database");

describe("database query builder", () => {
  it("converte regex de escopo em parâmetro PostgreSQL", async () => {
    const chamadas = [];
    const pgPool = {
      query: async (sql, params = []) => {
        chamadas.push({ sql: String(sql), params });
        return { rows: [] };
      },
    };
    const db = createDatabase(pgPool);

    await db.findLimited(
      "recibos",
      { deletado_em: { $exists: false }, escritorio: { $regex: /^Centro$/i } },
      { timestamp: -1 },
      51
    );

    const consulta = chamadas.find(({ sql }) => sql.startsWith("SELECT * FROM recibos"));
    assert.ok(consulta);
    assert.match(consulta.sql, /escritorio ~\* \$1/);
    assert.deepEqual(consulta.params, ["^Centro$"]);
  });
});
