-- Schema usado exclusivamente pelo pipeline de CI (job build-and-test).
-- É uma cópia do schema do produto -- mantenha os dois sincronizados
-- se alterar a estrutura das tabelas.

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'professional',  -- professional < expert < admin
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

-- usada pelo profile-service (foto e bio)
CREATE TABLE IF NOT EXISTS perfis (
  usuario_id INT PRIMARY KEY,
  nome VARCHAR(100),
  bio VARCHAR(280),
  foto_key VARCHAR(255),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- processos produtivos (ex.: "corte de chapa", "montagem do conjunto A")
CREATE TABLE IF NOT EXISTS processos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  atividade VARCHAR(20) NOT NULL,             -- montagem | almoxarifado | usinagem
  criado_por INT NOT NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (criado_por) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS projetos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  descricao TEXT,
  criado_por INT NOT NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (criado_por) REFERENCES usuarios(id)
);

-- cada material tem um RG, uma quantidade e o projeto a que pertence
CREATE TABLE IF NOT EXISTS itens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  projeto_id INT NOT NULL,
  rg VARCHAR(50) NOT NULL,
  nome VARCHAR(150) NOT NULL,
  quantidade INT NOT NULL DEFAULT 1,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (projeto_id) REFERENCES projetos(id) ON DELETE CASCADE,
  UNIQUE (projeto_id, rg)
);

-- demanda: trabalho de uma atividade dentro de um projeto, atribuído a um responsável.
-- Todo usuário vê só as demandas em que é responsável; excluir exige expert/admin.
CREATE TABLE IF NOT EXISTS demandas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  projeto_id INT NOT NULL,
  processo_id INT NULL,
  atividade VARCHAR(20) NOT NULL,             -- montagem | almoxarifado | usinagem
  descricao VARCHAR(255) NOT NULL,
  responsavel_id INT NOT NULL,
  funcionarios_usados INT NULL,               -- histórico real: alimenta a regressão
  status VARCHAR(20) NOT NULL DEFAULT 'aberta',  -- aberta | em_andamento | concluida
  criado_por INT NOT NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (projeto_id) REFERENCES projetos(id) ON DELETE CASCADE,
  FOREIGN KEY (processo_id) REFERENCES processos(id) ON DELETE SET NULL,
  FOREIGN KEY (responsavel_id) REFERENCES usuarios(id),
  FOREIGN KEY (criado_por) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS clientes_stripe (
  usuario_id         INT PRIMARY KEY,
  stripe_customer_id VARCHAR(64) NOT NULL UNIQUE,
  criado_em          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);
