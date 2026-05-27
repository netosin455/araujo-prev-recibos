"""
Execute este script UMA VEZ para gerar o refresh token do Google Drive.

Pré-requisitos:
  pip install google-auth-oauthlib

Passos:
  1. Acesse https://console.cloud.google.com/apis/credentials?project=sunny-advantage-468503-m4
  2. Clique em "Criar credenciais" > "ID do cliente OAuth 2.0"
  3. Tipo: "App para computador" (Desktop app)
  4. Baixe o JSON e salve como client_secret.json na mesma pasta deste script
  5. Execute: python gerar_token_drive.py
  6. Faça login com financeiroaraujoprev@gmail.com no navegador
  7. Copie o REFRESH_TOKEN exibido e adicione como variável de ambiente
     no Elastic Beanstalk: DRIVE_REFRESH_TOKEN
"""

import json
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/drive.file"]

flow = InstalledAppFlow.from_client_secrets_file("client_secret.json", SCOPES)
creds = flow.run_local_server(port=0)

print("\n" + "="*60)
print("REFRESH_TOKEN (adicione no Elastic Beanstalk):")
print("="*60)
print(creds.refresh_token)
print("="*60)
print("\nCLIENT_ID:")
print(creds.client_id)
print("\nCLIENT_SECRET:")
print(creds.client_secret)
