-- Schema usado pelo pipeline de CI (job build-and-test), aplicado no banco de teste.
-- Vai em .github/ci/schema.sql. É a junção de db/000_base.sql, db/001_dominio.sql e db/003_assinaturas.sql.
-- Se alterar qualquer um deles, regenere com:
--   cat db/000_base.sql db/001_dominio.sql db/003_assinaturas.sql > .github/ci/schema.sql
-- Os scripts antigos de banco/ (01-schema.sql, 02-migracao.sql) não valem mais.

-- ============================================================================
-- db/000_base.sql
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

-- ============================================================================
-- db/001_dominio.sql
-- ============================================================================

SET NAMES utf8mb4;

-- ---------- empresas ----------
CREATE TABLE IF NOT EXISTS organizacoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  codigo_convite VARCHAR(16) NOT NULL,          -- o Superior passa este código à equipe, que o digita no cadastro
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_organizacoes_nome (nome)
);

-- ---------- usuários: categoria e empresa ----------
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS categoria VARCHAR(20) NOT NULL DEFAULT 'superior';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS organizacao_id INT NULL;

-- ---------- projetos ----------
CREATE TABLE IF NOT EXISTS projetos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  descricao TEXT NULL,
  prazo_dias INT NULL,
  status ENUM('ativo', 'concluido') NOT NULL DEFAULT 'ativo',
  funcionarios_usados INT NULL,                  -- não é mais pedido na conclusão; mantido por compatibilidade
  criado_por INT NOT NULL,
  organizacao_id INT NULL,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  concluido_em DATETIME NULL,
  FOREIGN KEY (criado_por) REFERENCES usuarios(id)
);
ALTER TABLE projetos ADD COLUMN IF NOT EXISTS organizacao_id INT NULL;
ALTER TABLE projetos ADD COLUMN IF NOT EXISTS funcionarios_usados INT NULL;
ALTER TABLE projetos ADD COLUMN IF NOT EXISTS concluido_em DATETIME NULL;

-- ---------- demandas (cada demanda é um item: RG, material e quantidade, que percorre o fluxo) ----------
CREATE TABLE IF NOT EXISTS demandas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  projeto_id INT NOT NULL,
  organizacao_id INT NULL,
  rg VARCHAR(50) NOT NULL,
  nome_material VARCHAR(255) NOT NULL,
  quantidade INT NOT NULL DEFAULT 1,

  -- onde a demanda está agora
  etapa_atual ENUM('almoxarifado', 'operacao', 'montagem', 'finalizada') NOT NULL DEFAULT 'almoxarifado',

  -- quem fez o quê em cada etapa
  planejador_id INT NOT NULL,
  almoxarife_id INT DEFAULT NULL,
  operador_id INT DEFAULT NULL,
  montador_id INT DEFAULT NULL,

  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  finalizado_em DATETIME NULL,                   -- preenchido quando a Montagem finaliza: base da "demanda do mês"

  -- exclusão lógica: preenchida = a demanda está na aba Excluídas do Planejador
  excluida_em DATETIME NULL,
  excluida_por INT NULL,

  FOREIGN KEY (projeto_id) REFERENCES projetos(id) ON DELETE CASCADE,
  FOREIGN KEY (planejador_id) REFERENCES usuarios(id),
  FOREIGN KEY (almoxarife_id) REFERENCES usuarios(id),
  FOREIGN KEY (operador_id) REFERENCES usuarios(id),
  FOREIGN KEY (montador_id) REFERENCES usuarios(id)
);
ALTER TABLE demandas ADD COLUMN IF NOT EXISTS organizacao_id INT NULL;
ALTER TABLE demandas ADD COLUMN IF NOT EXISTS finalizado_em DATETIME NULL;
ALTER TABLE demandas ADD COLUMN IF NOT EXISTS excluida_em DATETIME NULL;
ALTER TABLE demandas ADD COLUMN IF NOT EXISTS excluida_por INT NULL;

-- ---------- modelo da previsão de equipe (um por usuário) ----------
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

-- ---------- dados que já existiam: tudo vai para uma única empresa de teste ----------
INSERT INTO organizacoes (nome, codigo_convite)
SELECT 'Empresa de teste (legado)', UPPER(SUBSTRING(MD5(UUID()), 1, 8))
FROM DUAL
WHERE EXISTS (SELECT 1 FROM usuarios WHERE organizacao_id IS NULL)
  AND NOT EXISTS (SELECT 1 FROM organizacoes WHERE nome = 'Empresa de teste (legado)');

UPDATE usuarios
   SET organizacao_id = (SELECT id FROM organizacoes WHERE nome = 'Empresa de teste (legado)')
 WHERE organizacao_id IS NULL;

UPDATE projetos p JOIN usuarios u ON u.id = p.criado_por
   SET p.organizacao_id = u.organizacao_id
 WHERE p.organizacao_id IS NULL;

UPDATE demandas d JOIN projetos p ON p.id = d.projeto_id
   SET d.organizacao_id = p.organizacao_id
 WHERE d.organizacao_id IS NULL;

-- projetos e demandas nunca ficam sem empresa (se sobrar alguma linha sem empresa, o comando falha de propósito)
ALTER TABLE projetos MODIFY organizacao_id INT NOT NULL;
ALTER TABLE demandas MODIFY organizacao_id INT NOT NULL;

-- ---------- chaves estrangeiras da empresa (só cria se ainda não existir) ----------
SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE usuarios ADD CONSTRAINT fk_usuarios_organizacao FOREIGN KEY (organizacao_id) REFERENCES organizacoes(id)',
  'SELECT ''fk_usuarios_organizacao já existe'' AS aviso')
  FROM information_schema.TABLE_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND CONSTRAINT_NAME = 'fk_usuarios_organizacao');
PREPARE passo FROM @sql; EXECUTE passo; DEALLOCATE PREPARE passo;

SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE projetos ADD CONSTRAINT fk_projetos_organizacao FOREIGN KEY (organizacao_id) REFERENCES organizacoes(id) ON DELETE CASCADE',
  'SELECT ''fk_projetos_organizacao já existe'' AS aviso')
  FROM information_schema.TABLE_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'projetos' AND CONSTRAINT_NAME = 'fk_projetos_organizacao');
PREPARE passo FROM @sql; EXECUTE passo; DEALLOCATE PREPARE passo;

SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE demandas ADD CONSTRAINT fk_demandas_organizacao FOREIGN KEY (organizacao_id) REFERENCES organizacoes(id) ON DELETE CASCADE',
  'SELECT ''fk_demandas_organizacao já existe'' AS aviso')
  FROM information_schema.TABLE_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'demandas' AND CONSTRAINT_NAME = 'fk_demandas_organizacao');
PREPARE passo FROM @sql; EXECUTE passo; DEALLOCATE PREPARE passo;

SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE demandas ADD CONSTRAINT fk_demandas_excluida_por FOREIGN KEY (excluida_por) REFERENCES usuarios(id) ON DELETE SET NULL',
  'SELECT ''fk_demandas_excluida_por já existe'' AS aviso')
  FROM information_schema.TABLE_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'demandas' AND CONSTRAINT_NAME = 'fk_demandas_excluida_por');
PREPARE passo FROM @sql; EXECUTE passo; DEALLOCATE PREPARE passo;

-- ---------- índices (toda consulta da API filtra pela empresa) ----------
CREATE INDEX IF NOT EXISTS idx_usuarios_organizacao ON usuarios (organizacao_id);
CREATE INDEX IF NOT EXISTS idx_projetos_organizacao ON projetos (organizacao_id, status);
CREATE INDEX IF NOT EXISTS idx_demandas_organizacao ON demandas (organizacao_id, etapa_atual, excluida_em);
CREATE INDEX IF NOT EXISTS idx_demandas_planejador ON demandas (planejador_id, excluida_em);
CREATE INDEX IF NOT EXISTS idx_demandas_projeto ON demandas (projeto_id, excluida_em);

-- ============================================================================
-- db/003_assinaturas.sql
-- ============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS assinaturas (
  usuario_id INT PRIMARY KEY,
  stripe_customer_id VARCHAR(64) NOT NULL,
  stripe_subscription_id VARCHAR(64) NOT NULL,
  plano VARCHAR(20) NOT NULL,                              -- expert
  status VARCHAR(30) NOT NULL,                             -- active | trialing | past_due | unpaid | canceled ...
  valor_mensal_centavos INT NOT NULL DEFAULT 0,            -- base do MRR (planos anuais entram divididos por 12)
  cancelamento_agendado BOOLEAN NOT NULL DEFAULT FALSE,    -- cancelou, mas ainda vale até o fim do período
  periodo_fim DATETIME NULL,
  atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX idx_assinaturas_status (status)
);

CREATE TABLE IF NOT EXISTS eventos_stripe (
  id VARCHAR(80) PRIMARY KEY,                              -- evt_... (id do evento no Stripe)
  tipo VARCHAR(60) NOT NULL,
  recebido_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_eventos_stripe_recebido (recebido_em)
);