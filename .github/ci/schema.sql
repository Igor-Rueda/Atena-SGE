-- Schema usado pelo pipeline de CI (job build-and-test). É uma CÓPIA EXATA de banco/01-schema.sql:
-- se alterar um, copie para o outro.

-- ============================================================================
-- Atenas SGE — schema do banco (MariaDB)
--
-- Cria todas as tabelas do produto. É IDEMPOTENTE: pode rodar mais de uma vez,
-- porque usa CREATE TABLE IF NOT EXISTS (tabelas que já existem são mantidas).
-- Execute com o banco já selecionado (ex.: USE nome_do_banco;).
--
-- Para um banco que JÁ TEM tabelas de uma versão anterior, rode também as alterações do
-- arquivo 02-migracao.sql (colunas novas em usuarios e itens).
--
-- Quem usa o quê:
--   usuarios, reset_tokens ........ auth-service
--   perfis ........................ profile-service (bio e referência da foto)
--   clientes_stripe ............... pagamentos
--   projetos, itens, demandas ..... app
--   modelos_regressao ............. regressao (modelo treinado de cada usuário)
-- ============================================================================

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'professional',    -- plano: professional < expert < admin
  categoria VARCHAR(20) NOT NULL DEFAULT 'superior',   -- superior | planejador | almoxarife | operador | montador
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reset_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(64) NOT NULL UNIQUE,
  usuario_id INT NOT NULL,
  criado_em DATETIME NOT NULL,
  expira_em DATETIME NOT NULL,
  usado BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS perfis (
  usuario_id INT PRIMARY KEY,
  nome VARCHAR(100),
  bio VARCHAR(280),
  foto_key VARCHAR(255),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- vínculo usuário <-> cliente do Stripe (o plano em si é sempre perguntado ao Stripe)
CREATE TABLE IF NOT EXISTS clientes_stripe (
  usuario_id INT PRIMARY KEY,
  stripe_customer_id VARCHAR(64) NOT NULL UNIQUE,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- status: ativo | concluido. Só projetos ATIVOS contam no limite do plano Professional.
CREATE TABLE IF NOT EXISTS projetos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  descricao TEXT,
  prazo_dias INT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ativo',
  funcionarios_usados INT NULL,
  concluido_em TIMESTAMP NULL,
  criado_por INT NOT NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (criado_por) REFERENCES usuarios(id),
  INDEX idx_projetos_dono_status (criado_por, status)
);

-- cada material tem um RG, uma quantidade e o projeto a que pertence.
-- concluido = o item já foi CONSUMIDO NA MONTAGEM (a soma das quantidades concluídas no mês é a "demanda").
CREATE TABLE IF NOT EXISTS itens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  projeto_id INT NOT NULL,
  rg VARCHAR(50) NOT NULL,
  nome VARCHAR(150) NOT NULL,
  quantidade INT NOT NULL DEFAULT 1,
  concluido BOOLEAN NOT NULL DEFAULT FALSE,
  concluido_em TIMESTAMP NULL,
  concluido_por INT NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (projeto_id) REFERENCES projetos(id) ON DELETE CASCADE,
  UNIQUE (projeto_id, rg),
  INDEX idx_itens_concluidos (concluido, concluido_em)
);

-- demanda: trabalho de um PROCESSO dentro de um projeto, atribuído a um responsável.
-- atividade = processo: planejamento | almoxarifado | fabricacao | montagem (nesta ordem no fluxo).
-- Todo usuário vê só as demandas em que é responsável; excluir exige expert/admin.
CREATE TABLE IF NOT EXISTS demandas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  projeto_id INT NOT NULL,
  atividade VARCHAR(20) NOT NULL,
  descricao VARCHAR(255) NOT NULL,
  responsavel_id INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'aberta',  -- aberta | em_andamento | concluida
  criado_por INT NOT NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (projeto_id) REFERENCES projetos(id) ON DELETE CASCADE,
  FOREIGN KEY (responsavel_id) REFERENCES usuarios(id),
  FOREIGN KEY (criado_por) REFERENCES usuarios(id),
  INDEX idx_demandas_responsavel (responsavel_id, status),
  INDEX idx_demandas_criador (criado_por, status)
);

-- modelo de regressão treinado por cada usuário (uma linha por recurso de análise).
-- resultado: JSON com coeficientes, métricas, faixa dos dados e pontos do ajuste.
CREATE TABLE IF NOT EXISTS modelos_regressao (
  usuario_id INT NOT NULL,
  recurso VARCHAR(40) NOT NULL,
  nome_arquivo VARCHAR(200),
  alvo VARCHAR(100) NOT NULL,
  n_linhas INT NOT NULL,
  resultado LONGTEXT NOT NULL,
  treinado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, recurso),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);
