"""
Importa o Caixa Araújo Prev 2025 (Google Forms Responses) para o sistema.

Uso:
  python importar_caixa2025.py

Requer: pip install openpyxl requests
"""

import openpyxl
import requests
import json
from datetime import datetime

EXCEL_PATH  = r"c:\Users\carlo\Downloads\Caixa Araújo Prev 2025 (Responses).xlsx"
SERVER_URL  = "http://araujo-prev-env.eba-cfsqbcw7.us-east-1.elasticbeanstalk.com"
ADMIN_USER  = ""
ADMIN_PASS  = ""

# Mapeamento escritório do formulário → nome padrão do sistema
ESCRITORIOS = {
    "terra rica - pr":             "Terra Rica - PR",
    "teodoro -  sp":               "Teodoro Sampaio - SP",
    "teodoro - sp":                "Teodoro Sampaio - SP",
    "teodoro sampaio - sp":        "Teodoro Sampaio - SP",
    "presidente venceslau - sp":   "Presidente Venceslau - SP",
    "primavera - sp":              "Primavera - SP",
    "ivinhema - ms":               "Ivinhema - MS",
}

FORMAS = {
    "pix":                 "Pix",
    "deposito caixa":      "Depósito Caixa",
    "depósito caixa":      "Depósito Caixa",
    "deposito lotérica":   "Depósito Lotérica",
    "depósito lotérica":   "Depósito Lotérica",
    "deposito loteri":     "Depósito Lotérica",
    "deposito lot":        "Depósito Lotérica",
    "ted":                 "TED",
    "deposito bb":         "Depósito BB",
    "depósito bb":         "Depósito BB",
}


def normalizar_escritorio(val: str) -> str:
    return ESCRITORIOS.get(val.strip().lower(), val.strip())


def normalizar_forma(val: str) -> str:
    low = val.strip().lower()
    for key, norm in FORMAS.items():
        if low.startswith(key):
            return norm
    return val.strip().title()


def formatar_data(val) -> str:
    if val is None:
        return ""
    if isinstance(val, datetime):
        return val.strftime("%d/%m/%Y")
    return str(val).strip()


def formatar_timestamp(val) -> int:
    if isinstance(val, datetime):
        return int(val.timestamp() * 1000)
    return int(datetime.now().timestamp() * 1000)


def ler_excel(path: str) -> list:
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))

    # Linha 1: vazia, Linha 2: título, Linha 3: cabeçalho — dados a partir da linha 4 (índice 3)
    registros = []
    contador = 1

    for row in rows[3:]:
        nome = str(row[1] or "").strip()
        # Pula linhas vazias, cabeçalhos repetidos ou sem dados úteis
        if not nome or nome.lower() in ("nome completo  do cliente", "nome completo do cliente"):
            continue
        if not row[3]:  # sem valor
            continue

        valor_raw = row[3]
        if isinstance(valor_raw, (int, float)):
            valor = f"{valor_raw:.2f}".replace(".", ",")
        else:
            valor = str(valor_raw).replace("R$", "").replace(" ", "").strip()

        num        = f"C25-{contador:04d}"
        cpf        = str(row[2] or "").strip()
        data       = formatar_data(row[4])
        forma      = normalizar_forma(str(row[6] or "Pix"))
        motivo     = str(row[7] or "").strip()
        escritorio = normalizar_escritorio(str(row[8] or ""))
        obs        = str(row[9] or "").strip()
        link       = str(row[10] or "").strip()
        ts         = formatar_timestamp(row[0])

        registros.append({
            "num":              num,
            "nome":             nome,
            "cpf":              cpf,
            "valor":            valor,
            "data":             data,
            "municipio_uf":     escritorio,
            "forma_pagamento":  forma,
            "motivo_pagamento": motivo,
            "escritorio":       escritorio,
            "complemento":      obs,
            "link_comprovante": link,
            "emitido_por":      "CAIXA 2025",
            "referencia":       "",
            "timestamp":        ts,
        })
        contador += 1

    return registros


def login(user: str, senha: str) -> str:
    r = requests.post(f"{SERVER_URL}/api/login", json={"username": user, "password": senha}, timeout=15)
    r.raise_for_status()
    token = r.json().get("token")
    if not token:
        raise RuntimeError("Login falhou: " + r.text)
    print("Login OK")
    return token


def importar_bulk(token: str, registros: list) -> dict:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    LOTE = 200
    total_importados = 0
    total_ignorados  = 0
    total_erros      = []

    for i in range(0, len(registros), LOTE):
        lote = registros[i:i + LOTE]
        fim  = min(i + LOTE, len(registros))
        print(f"   Lote {i+1}-{fim} de {len(registros)}...", end=" ", flush=True)
        r = requests.post(
            f"{SERVER_URL}/api/admin/importar-bulk",
            headers=headers,
            data=json.dumps(lote),
            timeout=120,
        )
        r.raise_for_status()
        res = r.json()
        total_importados += res.get("importados", 0)
        total_ignorados  += res.get("ignorados",  0)
        total_erros      += res.get("erros",       [])
        print(f"ok ({res.get('importados')} importados)")

    return {"importados": total_importados, "ignorados": total_ignorados, "erros": total_erros}


def reescrever_planilha(token: str) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    print("Reescrevendo planilha Google Sheets (pode demorar ~30s)...")
    r = requests.post(f"{SERVER_URL}/api/admin/reescrever-planilha", headers=headers, timeout=180)
    r.raise_for_status()
    return r.json()


def main():
    global ADMIN_USER, ADMIN_PASS

    if not ADMIN_USER:
        ADMIN_USER = input("Usuário admin: ").strip()
    if not ADMIN_PASS:
        ADMIN_PASS = input("Senha admin: ").strip()

    print("\nLendo Excel: " + EXCEL_PATH)
    registros = ler_excel(EXCEL_PATH)
    print(f"   {len(registros)} registros validos encontrados")
    print(f"   Numeracao: {registros[0]['num']} -> {registros[-1]['num']}")
    print(f"   Exemplo: {registros[0]['nome']} | {registros[0]['data']} | R$ {registros[0]['valor']} | {registros[0]['escritorio']}")

    token = login(ADMIN_USER, ADMIN_PASS)

    print(f"\nEnviando {len(registros)} registros...")
    resultado = importar_bulk(token, registros)
    print(f"   Importados:  {resultado.get('importados')}")
    print(f"   Ja existiam: {resultado.get('ignorados')}")
    if resultado.get("erros"):
        print(f"   Erros: {resultado['erros']}")

    print("\nReescrevendo planilha Google Sheets...")
    res = reescrever_planilha(token)
    print("   " + str(res.get('mensagem', res)))

    print("\nConcluido!")


if __name__ == "__main__":
    main()
