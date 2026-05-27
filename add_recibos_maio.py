"""
Adiciona 5 recibos de maio/2026 que estavam faltando no sistema.

Uso:
  python add_recibos_maio.py

Requer: pip install requests
"""

import requests
import json
from datetime import datetime

SERVER_URL = "http://araujo-prev-env.eba-cfsqbcw7.us-east-1.elasticbeanstalk.com"

ADMIN_USER = ""
ADMIN_PASS = ""

RECIBOS = [
    {"nome": "MARINA JOSE DOS SANTOS",            "valor": "300,00",    "data": "11/05/2026"},
    {"nome": "ALESSANDRA DOS SANTOS DIAS",         "valor": "300,00",    "data": "15/05/2026"},
    {"nome": "SEVERINA DA SILVA SANTOS",           "valor": "350,00",    "data": "15/05/2026"},
    {"nome": "MARIA APARECIDA DE AGUIAR SILVA",    "valor": "1.621,00",  "data": "16/05/2026"},
    {"nome": "SUZANA CRISTINA DE B. VIEIRA DALEFI","valor": "4.863,00",  "data": "19/05/2026"},
]

EMITIDO_POR  = "neto"
ESCRITORIO   = "primavera"
FORMA_PGTO   = "PIX"
CPF          = "000.000.000-00"


def login(user: str, senha: str) -> str:
    r = requests.post(f"{SERVER_URL}/api/login", json={"username": user, "password": senha}, timeout=15)
    r.raise_for_status()
    token = r.json().get("token")
    if not token:
        raise RuntimeError("Login falhou: " + r.text)
    print("✅ Login OK")
    return token


def proximo_num(token: str) -> str:
    headers = {"Authorization": f"Bearer {token}"}
    r = requests.get(f"{SERVER_URL}/api/proximo-num", headers=headers, timeout=15)
    r.raise_for_status()
    return r.json().get("num", "")


def data_para_timestamp(data_br: str) -> int:
    try:
        dt = datetime.strptime(data_br, "%d/%m/%Y")
        dt = dt.replace(hour=12)
        return int(dt.timestamp() * 1000)
    except Exception:
        return int(datetime.now().timestamp() * 1000)


def montar_registros(num_inicial: str) -> list:
    partes = num_inicial.split("/")
    seq    = int(partes[0])
    ano    = partes[1] if len(partes) > 1 else str(datetime.now().year)

    registros = []
    for i, rec in enumerate(RECIBOS):
        num = f"{seq + i}/{ano}"
        registros.append({
            "num":             num,
            "nome":            rec["nome"],
            "cpf":             CPF,
            "valor":           rec["valor"],
            "data":            rec["data"],
            "forma_pagamento": FORMA_PGTO,
            "emitido_por":     EMITIDO_POR,
            "escritorio":      ESCRITORIO,
            "motivo_pagamento": "Honorários Advocatícios",
            "municipio_uf":    "",
            "complemento":     "",
            "referencia":      "",
            "link_comprovante": "",
            "timestamp":       data_para_timestamp(rec["data"]),
        })
    return registros


def importar_bulk(token: str, registros: list) -> dict:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    r = requests.post(
        f"{SERVER_URL}/api/admin/importar-bulk",
        headers=headers,
        data=json.dumps(registros),
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def reescrever_planilha(token: str) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    print("⏳ Reescrevendo planilha Google Sheets (pode demorar ~30s)...")
    r = requests.post(f"{SERVER_URL}/api/admin/reescrever-planilha", headers=headers, timeout=180)
    r.raise_for_status()
    return r.json()


def main():
    global ADMIN_USER, ADMIN_PASS

    if not ADMIN_USER:
        ADMIN_USER = input("Usuário admin: ").strip()
    if not ADMIN_PASS:
        ADMIN_PASS = input("Senha admin: ").strip()

    token = login(ADMIN_USER, ADMIN_PASS)

    print("\n🔢 Buscando próximo número de recibo...")
    num_ini = proximo_num(token)
    print(f"   Próximo num: {num_ini}")

    registros = montar_registros(num_ini)
    print(f"\n📋 {len(registros)} recibos a importar:")
    for r in registros:
        print(f"   [{r['num']}] {r['nome']} — R$ {r['valor']} — {r['data']}")

    print(f"\n📤 Enviando para o servidor...")
    resultado = importar_bulk(token, registros)
    print(f"   ✅ Importados:  {resultado.get('importados')}")
    print(f"   ⏭  Já existiam: {resultado.get('ignorados')}")
    if resultado.get("erros"):
        print(f"   ⚠️  Erros: {resultado['erros']}")

    resp = input("\n📊 Reescrever planilha Google Sheets agora? (s/n): ").strip().lower()
    if resp == "s":
        res = reescrever_planilha(token)
        print(f"   ✅ {res.get('mensagem', res)}")
    else:
        print("   ⏭  Pulado. Clique em 'Limpar e reescrever do zero' no painel admin quando quiser.")

    print("\n✅ Concluído!")


if __name__ == "__main__":
    main()
