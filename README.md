# Araujo Prev — Sistema de Recibos

Sistema web de gestão de recibos da A Araujo Serviços Ltda ME.

---

## Onde cada coisa fica

```
Araujo_Prev_Recibos/
│
├── web/                         ← PASTA PRINCIPAL DO SISTEMA
│   │
│   ├── server.js                ← SERVIDOR: regras de negócio, login, banco de dados
│   │                               Mexe aqui quando quiser mudar:
│   │                               - Campos do recibo
│   │                               - Regras de permissão (admin, financeiro, recepção)
│   │                               - Tempo de expiração do login
│   │
│   ├── public/
│   │   ├── index.html           ← TELA: o que o usuário vê (layout, botões, menus)
│   │   │                           Mexe aqui quando quiser mudar:
│   │   │                           - Textos e labels
│   │   │                           - Cores e visual (CSS no início do arquivo)
│   │   │                           - Adicionar novos campos no formulário
│   │   │
│   │   ├── app.js               ← COMPORTAMENTO: o que acontece quando clica em algo
│   │   │                           Mexe aqui quando quiser mudar:
│   │   │                           - O que cada botão faz
│   │   │                           - Como os dados são enviados ao servidor
│   │   │                           - Geração do PDF na tela
│   │   │
│   │   ├── logo.png             ← Logo que aparece no sistema e nos recibos
│   │   │
│   │   └── manifest.json        ← Configurações do app no celular (ícone, nome)
│   │
│   └── package.json             ← Lista de bibliotecas que o sistema usa
│
├── .ebextensions/               ← Configurações do servidor AWS (não mexer)
│   └── 01_data_dir.config       ← Garante que os dados persistem entre deploys
│
├── Procfile                     ← Diz ao AWS como iniciar o sistema (não mexer)
├── package.json                 ← Dependências para o AWS instalar (não mexer)
└── .gitignore                   ← Arquivos que o Git ignora (senhas, node_modules)
```

---

## Como atualizar o sistema

1. Abre o arquivo que quer mudar (veja o mapa acima)
2. Faz a alteração
3. Abre o terminal na pasta do projeto
4. Roda:

```bash
git add .
git commit -m "descreva o que mudou"
git push origin main
```

O sistema atualiza automaticamente em ~2 minutos.

---

## Onde o sistema está no ar

**URL:** http://araujo-prev-env.eba-cfsqbcw7.us-east-1.elasticbeanstalk.com

**Painel AWS:** console.aws.amazon.com → Elastic Beanstalk → araujo-prev

---

## Variáveis de ambiente (senhas e configurações secretas)

Ficam no painel do Elastic Beanstalk — nunca no código.

| Variável     | O que é                        |
|--------------|--------------------------------|
| ADMIN_USER   | Nome do usuário administrador  |
| ADMIN_PASS   | Senha do administrador         |
| JWT_SECRET   | Chave de segurança dos tokens  |
| DATA_DIR     | Pasta onde o banco fica salvo  |
| PORT         | Porta do servidor (padrão 8080)|
