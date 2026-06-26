// services/fila.js — produtor da fila SQS (jobs de processamento assíncrono)
const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");

const QUEUE_URL = process.env.EXPORT_QUEUE_URL || "";
const sqs = new SQSClient({ region: process.env.AWS_REGION || "us-east-1" });

const filaConfigurada = () => !!QUEUE_URL;

// Envia um job pra fila. payload vira o corpo JSON da mensagem.
async function enviarJobExport(payload) {
  if (!QUEUE_URL) throw new Error("EXPORT_QUEUE_URL não configurado.");
  await sqs.send(new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify(payload),
  }));
}

module.exports = { enviarJobExport, filaConfigurada };
