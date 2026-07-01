const swaggerJsdoc = require("swagger-jsdoc");
const glob = require("glob");
const path = require("path");

const routeFiles = glob.globSync("routes/*.js", { cwd: __dirname }).map(f => path.resolve(__dirname, f));

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Araujo Prev Recibos API",
      version: "1.0.0",
      description: "API do sistema de recibos Araujo Prev",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "token",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: { erro: { type: "string" } },
        },
        Recibo: {
          type: "object",
          properties: {
            _id: { type: "string" },
            num: { type: "integer" },
            cliente_nome: { type: "string" },
            cpf: { type: "string" },
            valor: { type: "number" },
            data_emissao: { type: "string" },
            referencia: { type: "string" },
            forma_pagamento: { type: "string" },
            escritorio: { type: "string" },
            motivo_pagamento: { type: "string" },
            status_pagamento: { type: "string", enum: ["pendente", "pago", "cancelado"] },
          },
        },
        Cliente: {
          type: "object",
          properties: {
            _id: { type: "string" },
            nome: { type: "string" },
            cpf: { type: "string" },
            num_parcelas: { type: "integer" },
            valor_contrato: { type: "number" },
            parcelas: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  num: { type: "integer" },
                  valor: { type: "number" },
                  status: { type: "string", enum: ["pendente", "pago", "atrasado"] },
                  data_vencimento: { type: "string" },
                },
              },
            },
          },
        },
        LoginRequest: {
          type: "object",
          required: ["username", "password"],
          properties: {
            username: { type: "string" },
            password: { type: "string" },
          },
        },
      },
    },
  },
  apis: routeFiles,
};

module.exports = swaggerJsdoc(options);
