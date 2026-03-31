# 📄 Gerador Automático de Recibos

App desktop (Electron) + backend serverless na AWS.

---

## Arquitetura

```
[App Electron] → POST → [API Gateway] → [Lambda Python] → [S3]
                                              ↑
                                    docxtpl preenche template
```

---

## Pré-requisitos

- Node.js 18+
- Python 3.11+
- AWS CLI configurado (`aws configure`)
- Conta AWS com permissões para Lambda, S3, API Gateway e IAM

---

## Passo a Passo

### 1. Criar o template .docx

Crie um arquivo `template/recibo_template.docx` com as variáveis:

```
Nome: {{ nome }}
CPF:  {{ cpf }}
Cidade: {{ cidade }}
Valor: R$ {{ valor }}
Descrição: {{ descricao }}
Data: {{ data }}
```

Use exatamente `{{ variavel }}` dentro do Word.

### 2. Criar Role IAM para a Lambda

No console AWS → IAM → Roles → Create Role:
- Trusted entity: Lambda
- Policies: `AmazonS3FullAccess` + `AWSLambdaBasicExecutionRole`
- Anote a ARN da role criada

### 3. Criar bucket S3 e fazer upload do template

```bash
aws s3 mb s3://meu-bucket-recibos --region us-east-1
aws s3 cp template/recibo_template.docx s3://meu-bucket-recibos/templates/recibo_template.docx
```

### 4. Deploy da Lambda

```bash
cd backend
bash deploy.sh recibo-generator meu-bucket-recibos us-east-1 arn:aws:iam::SEU_ACCOUNT:role/NOME_DA_ROLE
```

### 5. Criar API Gateway

```bash
cd infra
bash setup.sh meu-bucket-recibos arn:aws:lambda:us-east-1:SEU_ACCOUNT:function:recibo-generator us-east-1
```

O script vai imprimir o endpoint. Copie-o.

### 6. Configurar o app

Edite `frontend/renderer.js` linha 2:
```js
const API_URL = "https://SEU_API_ID.execute-api.us-east-1.amazonaws.com/prod/gerar-recibo";
```

### 7. Rodar o app localmente

```bash
cd frontend
npm install
npm start
```

### 8. Gerar instalador .exe (distribuir para outros PCs)

```bash
cd frontend
npm run build
```

O instalador estará em `frontend/dist/`.

---

## Variáveis de Ambiente da Lambda

| Variável       | Descrição                        | Padrão                          |
|----------------|----------------------------------|---------------------------------|
| BUCKET_NAME    | Nome do bucket S3                | obrigatório                     |
| TEMPLATE_KEY   | Caminho do template no S3        | templates/recibo_template.docx  |

---

## Testando via curl

```bash
curl -X POST https://SEU_ENDPOINT/prod/gerar-recibo \
  -H "Content-Type: application/json" \
  -d '{
    "nome": "João da Silva",
    "cpf": "123.456.789-00",
    "cidade": "São Paulo - SP",
    "valor": "1.500,00",
    "descricao": "Consultoria em TI",
    "data": "15/01/2025"
  }'
```

Resposta:
```json
{
  "url": "https://meu-bucket.s3.amazonaws.com/recibos/15-01-2025_joao_143022.docx?...",
  "arquivo": "recibos/15-01-2025_joao_143022.docx"
}
```

---

## Custos AWS (estimativa)

- Lambda: gratuito até 1M requisições/mês
- S3: ~$0.023/GB armazenado
- API Gateway: gratuito até 1M chamadas/mês

Para uso pessoal/pequeno volume: **praticamente gratuito**.
