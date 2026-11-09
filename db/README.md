# Banco de dados do Atenas SGE (MariaDB)

Esta pasta tem tudo que é preciso para **recriar o banco do zero** a partir do repositório.
Os scripts foram testados no MariaDB 10.11 (a mesma versão do CI), em banco vazio e rodando duas vezes seguidas.

| Arquivo | O que faz | Quando rodar |
|---|---|---|
| `000_base.sql` | Tabelas base: `usuarios`, `reset_tokens`, `perfis`, `clientes_stripe` | Sempre, primeiro |
| `001_dominio.sql` | Tabelas do domínio: `organizacoes`, `projetos`, `demandas`, `modelos_regressao`, chaves estrangeiras e índices | Sempre, depois do 000 |
| `002_seed.sql` | Dados de exemplo: 2 empresas, 11 contas, projetos e demandas | **Só em desenvolvimento e teste** |

Todos podem ser rodados mais de uma vez: não apagam nem duplicam nada.

## Como recriar o banco (quem acabou de clonar o repositório)

**Requisito:** MariaDB 10.5 ou superior (testado no 10.11).

### 1. Criar o banco

```sql
CREATE DATABASE atenas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

O `utf8mb4` é necessário para os acentos. O `_ci` (sem diferenciar maiúsculas) faz o e-mail ser único mesmo com letras maiúsculas diferentes.
Se o seu banco tem outro nome, use o nome dele nos comandos abaixo no lugar de `atenas`.

### 2. Rodar os scripts em ordem

Na raiz do repositório:

```bash
mariadb --default-character-set=utf8mb4 -u root -p atenas < db/000_base.sql
mariadb --default-character-set=utf8mb4 -u root -p atenas < db/001_dominio.sql
mariadb --default-character-set=utf8mb4 -u root -p atenas < db/002_seed.sql   # opcional, só em teste
```

Se o banco roda em Docker:

```bash
docker compose exec -T mariadb mariadb --default-character-set=utf8mb4 -u root -p<SENHA> atenas < db/000_base.sql
docker compose exec -T mariadb mariadb --default-character-set=utf8mb4 -u root -p<SENHA> atenas < db/001_dominio.sql
docker compose exec -T mariadb mariadb --default-character-set=utf8mb4 -u root -p<SENHA> atenas < db/002_seed.sql
```

Se preferir uma ferramenta gráfica (DBeaver, Workbench, HeidiSQL), abra o banco criado no passo 1 e execute cada arquivo, na ordem.
Os scripts não têm a linha `USE`, de propósito: eles rodam no banco que você escolheu.

### 3. Conferir

```sql
SHOW TABLES;
```

Devem aparecer 8 tabelas: `clientes_stripe`, `demandas`, `modelos_regressao`, `organizacoes`, `perfis`, `projetos`, `reset_tokens` e `usuarios`.
O `001_dominio.sql` e o `002_seed.sql` terminam com uma consulta de conferência (usuários, projetos e demandas por empresa).

### 4. Apontar a aplicação para o banco

Copie `env.example` para `.env` e preencha os dados do banco (veja o README principal) e suba com `docker compose up --build`.

## Modelo de dados

```
organizacoes (empresa)
   │ 1
   ├──< usuarios           (usuarios.organizacao_id)
   ├──< projetos           (projetos.organizacao_id, projetos.criado_por -> usuarios)
   └──< demandas           (demandas.organizacao_id)

projetos 1 ──< demandas    (demandas.projeto_id, ON DELETE CASCADE)

usuarios 1 ──< demandas    (planejador_id, almoxarife_id, operador_id, montador_id, excluida_por)
usuarios 1 ──< modelos_regressao   (um modelo de previsão por usuário)
usuarios 1 ──< reset_tokens | perfis | clientes_stripe
```

- **Isolamento entre empresas:** cada usuário pertence a **uma** empresa, e projetos e demandas carregam o `organizacao_id`.
  A API filtra tudo por ele. Apagar uma empresa apaga os projetos e as demandas dela (`ON DELETE CASCADE`).
- **Demanda:** percorre `almoxarifado` → `operacao` → `montagem` → `finalizada`. `finalizado_em` é a base da "demanda do mês" da previsão.
  A exclusão é lógica (`excluida_em`, `excluida_por`).
- **Quem usa cada tabela:** `usuarios` e `reset_tokens` (auth-service), `perfis` (profile-service), `clientes_stripe` (pagamentos),
  `organizacoes`, `projetos` e `demandas` (app), `modelos_regressao` (regressao).

## Contas de exemplo (só com o `002_seed.sql`)

> **Nunca rode o seed em produção.** As contas têm senha pública e os códigos das empresas (`ALFA2026`, `BETA2026`) são previsíveis.

**Senha de todas as contas:** `Atenas@2026`

| Empresa | Código | Conta | Categoria | Plano |
|---|---|---|---|---|
| Metalúrgica Alfa (exemplo) | `ALFA2026` | `superior@alfa.exemplo.com` | Superior | Expert |
| | | `planejador@alfa.exemplo.com` | Planejador | Professional |
| | | `almoxarife@alfa.exemplo.com` | Almoxarife | Professional |
| | | `operador@alfa.exemplo.com` | Operador | Professional |
| | | `montador@alfa.exemplo.com` | Montador | Professional |
| | | `admin@atenas.exemplo.com` | Superior | Admin (consulta de logs) |
| Usinagem Beta (exemplo) | `BETA2026` | `superior@beta.exemplo.com` | Superior | Professional |
| | | `planejador@beta.exemplo.com` | Planejador | Professional |
| | | `almoxarife@beta.exemplo.com` | Almoxarife | Professional |
| | | `operador@beta.exemplo.com` | Operador | Professional |
| | | `montador@beta.exemplo.com` | Montador | Professional |

**Como ver o isolamento funcionando:** entre como `planejador@beta.exemplo.com` e confira que só aparecem os projetos e as demandas da Usinagem Beta.
Depois tente, pela API, abrir um ID de projeto ou demanda da Alfa: a resposta é `404`.

## Banco que já existia antes das empresas

Se o seu banco já tinha usuários de uma versão anterior, rode o `001_dominio.sql` normalmente: ele não apaga nada.
Todas as contas sem empresa entram numa empresa chamada **"Empresa de teste (legado)"**, e os projetos e as demandas antigos passam a pertencer a ela.
Isso faz todos os usuários antigos se enxergarem. Se eles são de empresas diferentes, separe-os **antes de subir a nova versão da API**:

```sql
INSERT INTO organizacoes (nome, codigo_convite) VALUES ('Minha empresa', 'TROQUE-ESTE-CODIGO');
UPDATE usuarios SET organizacao_id = (SELECT id FROM organizacoes WHERE nome = 'Minha empresa')
 WHERE email = 'pessoa@exemplo.com';
UPDATE projetos p JOIN usuarios u ON u.id = p.criado_por SET p.organizacao_id = u.organizacao_id;
UPDATE demandas d JOIN projetos p ON p.id = d.projeto_id SET d.organizacao_id = p.organizacao_id;
```

Depois, o Superior de cada empresa pode renovar o código pelo botão *Equipe* da lista de projetos.

## CI

O pipeline usa o mesmo banco: o arquivo `.github/ci/schema.sql` é a junção do `000_base.sql` com o `001_dominio.sql`.
Depois de alterar qualquer um dos dois, atualize o do CI:

```bash
cat db/000_base.sql db/001_dominio.sql > .github/ci/schema.sql
```

Os scripts antigos da pasta `banco/` (`01-schema.sql`, `02-migracao.sql`) não valem mais e não devem ser usados.
