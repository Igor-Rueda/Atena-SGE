-- ============================================================================
-- Atenas SGE — 001_dominio.sql: empresas (organizações), projetos, demandas e modelo de regressão
--
-- Serve para criar o banco do zero e também para atualizar um banco já em uso.
-- Pode ser rodado várias vezes sem estragar nada e NÃO apaga dados.
--
-- Pré-requisito: a tabela `usuarios` (criada pelo 000_base.sql ou pelo auth-service).
-- Rode com o banco já escolhido na linha de comando (veja db/README.md), por exemplo:
--   mariadb --default-character-set=utf8mb4 -u root -p atenas < db/001_dominio.sql
-- Depois, se quiser dados de exemplo, rode o 002_seed.sql.
--
-- Isolamento (multi-tenancy): cada usuário pertence a UMA empresa (usuarios.organizacao_id).
-- Projetos e demandas carregam o organizacao_id da empresa, e a API filtra tudo por ele.
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
-- Só afeta um banco que já tinha usuários antes das empresas existirem. Num banco novo (sem usuários)
-- isto não faz nada. ATENÇÃO: num banco com clientes reais, separe as contas por empresa depois (veja README).
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

-- Para mudar alguém de empresa (por exemplo, juntar a equipe de teste numa empresa só):
--   UPDATE usuarios SET organizacao_id = (SELECT id FROM organizacoes WHERE nome = 'Minha empresa')
--    WHERE email = 'pessoa@exemplo.com';

-- ---------- conferência ----------
SELECT o.id, o.nome,
       (SELECT COUNT(*) FROM usuarios u WHERE u.organizacao_id = o.id) AS usuarios,
       (SELECT COUNT(*) FROM projetos p WHERE p.organizacao_id = o.id) AS projetos,
       (SELECT COUNT(*) FROM demandas d WHERE d.organizacao_id = o.id) AS demandas
  FROM organizacoes o ORDER BY o.id;
