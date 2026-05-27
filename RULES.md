# RULES.md — Regras do Projeto

> Documento de referência para humanos e agentes de IA.
> Toda decisão de código deve ser consistente com estas regras.

---

## Código

- Sempre usar tipagem (type hints em Python, TypeScript em JS)
- Funções devem ter responsabilidade única e no máximo ~40 linhas
- Nunca duplicar código — extraia para utilitário reutilizável
- Comentários explicam o **porquê**, não o **o quê**
- Nomes de variáveis e funções devem ser autoexplicativos

## Segurança

- Nenhuma credencial, token ou senha no código-fonte
- Toda configuração sensível vai em `.env` (nunca commitado)
- Validar todos os inputs antes de processar
- Logs nunca devem conter dados pessoais ou sensíveis
- Toda rota autenticada deve validar o token antes de executar lógica

## Erros e Exceções

- Todo I/O (arquivo, banco, rede, automação) deve ter try/except
- Nunca use `except: pass` sem log e justificativa
- Erros críticos devem ser logados e, se necessário, interromper o fluxo
- Implemente retry com backoff exponencial em operações de rede e automação

## Logs

- Toda ação crítica deve gerar log com timestamp
- Formato padrão: `[YYYY-MM-DD HH:MM:SS] [NÍVEL] mensagem`
- Níveis: DEBUG, INFO, WARNING, ERROR, CRITICAL
- Logs ficam em `logs/` e nunca são commitados

## Automação

- Use waits explícitos — nunca `time.sleep()` arbitrário
- Valide o estado da página/elemento antes de interagir
- Mínimo 3 tentativas com backoff antes de falhar definitivamente
- Logue cada ação com resultado (sucesso/falha)

## Documentação

- Toda função com lógica não trivial deve ter docstring
- Toda alteração relevante vai em `docs/changelog.md`
- README sempre reflete o estado atual do projeto
- Decisões de arquitetura ficam em `docs/architecture.md`

## Testes

- Todo módulo novo deve ter testes em `tests/`
- Cubra: caminho feliz, input inválido, falha de dependência
- Nomes de teste devem descrever o cenário testado

## Git

- Commits atômicos e descritivos
- Nunca commitar: `.env`, `logs/`, `__pycache__/`, credenciais
- Branches por feature: `feature/nome-da-feature`
