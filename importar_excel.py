"""
Importa todos os registros do Excel para o servidor Araujo Prev.

Uso:
  python importar_excel.py

Requer: pip install openpyxl requests
"""

import openpyxl
import requests
import json
import sys
from datetime import datetime

# ── CONFIGURAÇÃO ──────────────────────────────────────────────
EXCEL_PATH = r"c:\Users\carlo\Downloads\Caixa Araújo Prev 2026 (respostas) (3).xlsx"
SERVER_URL = "http://araujo-prev-env.eba-cfsqbcw7.us-east-1.elasticbeanstalk.com"

# Credenciais admin (preencha aqui ou vai pedir interativamente)
ADMIN_USER = ""
ADMIN_PASS = ""


def login(user: str, senha: str) -> str:
    r = requests.post(f"{SERVER_URL}/api/login", json={"username": user, "password": senha}, timeout=15)
    r.raise_for_status()
    token = r.json().get("token")
    if not token:
        raise RuntimeError("Login falhou: " + r.text)
    print("✅ Login OK")
    return token


def formatar_data(val) -> str:
    if val is None:
        return ""
    if isinstance(val, datetime):
        return val.strftime("%d/%m/%Y")
    return str(val)


def formatar_timestamp(val) -> int:
    if isinstance(val, datetime):
        return int(val.timestamp() * 1000)
    return 0


def ler_excel(path: str) -> list:
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))

    registros = []
    for row in rows[3:]:  # pula cabeçalhos (linhas 1-3)
        if row[0] is None or row[1] is None:
            continue

        carimbo  = row[0]
        nome     = str(row[1] or "").strip()
        cpf      = str(row[2] or "").strip()
        valor    = str(row[3] or "").replace("R$", "").replace(" ", "").strip()
        data     = formatar_data(row[4])
        forma    = str(row[6] or "").strip()
        motivo   = str(row[7] or "").strip()
        escrit   = str(row[8] or "").strip()
        link     = str(row[10] or "").strip()
        num      = str(row[12] or "").strip()
        emitido  = str(row[13] or "").strip() if len(row) > 13 else ""
        ref      = str(row[14] or "").strip() if len(row) > 14 else ""
        ts       = formatar_timestamp(carimbo)

        if not num:
            continue

        registros.append({
            "num":             num,
            "nome":            nome,
            "cpf":             cpf,
            "valor":           valor,
            "data":            data,
            "municipio_uf":    escrit,
            "forma_pagamento": forma,
            "motivo_pagamento": motivo,
            "escritorio":      escrit,
            "link_comprovante": link,
            "emitido_por":     emitido,
            "referencia":      ref,
            "timestamp":       ts,
        })

    return registros


def importar_bulk(token: str, registros: list) -> dict:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    r = requests.post(
        f"{SERVER_URL}/api/admin/importar-bulk",
        headers=headers,
        data=json.dumps(registros),
        timeout=120,
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

    print(f"\n📂 Lendo Excel: {EXCEL_PATH}")
    registros = ler_excel(EXCEL_PATH)
    print(f"   {len(registros)} registros encontrados ({registros[0]['num']} → {registros[-1]['num']})")

    token = login(ADMIN_USER, ADMIN_PASS)

    print(f"\n📤 Enviando {len(registros)} registros para o servidor...")
    resultado = importar_bulk(token, registros)
    print(f"   ✅ Importados: {resultado.get('importados')}")
    print(f"   ⏭  Já existiam: {resultado.get('ignorados')}")
    if resultado.get("erros"):
        print(f"   ⚠️  Erros: {resultado['erros']}")

    resp = input("\n📊 Reescrever planilha Google Sheets agora? (s/n): ").strip().lower()
    if resp == "s":
        res = reescrever_planilha(token)
        print(f"   ✅ {res.get('mensagem', res)}")
    else:
        print("   ⏭  Pulado. Execute 'Limpar e reescrever do zero' no painel admin quando quiser.")

    print("\n✅ Concluído!")


if __name__ == "__main__":
    main()
