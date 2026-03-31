import json
import boto3
import os
import re
from io import BytesIO
from datetime import datetime
from docxtpl import DocxTemplate

s3 = boto3.client("s3")
BUCKET = os.environ["BUCKET_NAME"]
TEMPLATE_KEY = os.environ.get("TEMPLATE_KEY", "templates/recibo_template.docx")


def sanitize(text):
    return re.sub(r"[^\w\-]", "_", str(text))


def generate_filename(nome, data):
    nome_clean = sanitize(nome.split()[0].lower())
    data_clean = data.replace("/", "-")
    ts = datetime.now().strftime("%H%M%S")
    return f"recibos/{data_clean}_{nome_clean}_{ts}.docx"


def lambda_handler(event, context):
    try:
        body = json.loads(event.get("body", "{}"))

        required = ["nome", "municipio_uf", "valor", "acao", "data"]
        missing = [f for f in required if not body.get(f)]
        if missing:
            return response(400, {"erro": f"Campos obrigatórios: {missing}"})

        # Baixa template do S3
        obj = s3.get_object(Bucket=BUCKET, Key=TEMPLATE_KEY)
        template_bytes = BytesIO(obj["Body"].read())

        # Preenche template
        doc = DocxTemplate(template_bytes)
        doc.render({
            "nome":         body["nome"].upper(),
            "municipio_uf": body["municipio_uf"].upper(),
            "valor":        body["valor"],
            "acao":         body["acao"],
            "data":         body["data"],
        })

        # Salva .docx no S3
        output = BytesIO()
        doc.save(output)
        output.seek(0)

        key = generate_filename(body["nome"], body["data"])
        s3.put_object(
            Bucket=BUCKET,
            Key=key,
            Body=output.getvalue(),
            ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )

        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": BUCKET, "Key": key},
            ExpiresIn=3600,
        )

        return response(200, {"url": url, "arquivo": key})

    except Exception as e:
        return response(500, {"erro": str(e)})


def response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body, ensure_ascii=False),
    }
