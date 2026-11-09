-- ============================================================================
-- Atenas SGE — 000_base.sql: tabelas base (usuários, perfis e pagamentos)
--
-- São as tabelas que os serviços auth-service, profile-service e pagamentos usam.
-- Elas ficam aqui para que quem clonar o repositório consiga criar o banco do ZERO
-- (o 001_dominio.sql depende da tabela `usuarios`).
--
-- Pode ser rodado várias vezes: usa CREATE TABLE IF NOT EXISTS e não apaga nada.
-- Rode com o banco já escolhido na linha de comando (veja db/README.md), por exemplo:
--   mariadb --default-character-set=utf8mb4 -u root -p atenas < db/000_base.sql
-- ============================================================================

SET NAMES utf8mb4;

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
