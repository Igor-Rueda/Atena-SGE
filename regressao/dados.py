"""Lê do MariaDB os projetos CONCLUÍDOS de um usuário (o histórico real que ensina o modelo)."""
import os

import numpy as np
import pymysql

SQL = """
SELECT
  (SELECT COUNT(*) FROM itens i WHERE i.projeto_id = p.id)                         AS n_itens,
  (SELECT COALESCE(SUM(i.quantidade), 0) FROM itens i WHERE i.projeto_id = p.id)   AS qtd_total,
  (SELECT COUNT(DISTINCT d.atividade) FROM demandas d WHERE d.projeto_id = p.id)   AS n_atividades,
  p.prazo_dias,
  p.funcionarios_usados
FROM projetos p
WHERE p.criado_por = %s
  AND p.status = 'concluido'
  AND p.funcionarios_usados IS NOT NULL
  AND p.prazo_dias IS NOT NULL AND p.prazo_dias > 0
"""


def _conectar():
    return pymysql.connect(
        host=os.environ.get('DB_HOST'),
        user=os.environ.get('DB_USER'),
        password=os.environ.get('DB_PASSWORD'),
        database=os.environ.get('DB_NAME'),
        connect_timeout=3,
        read_timeout=5,
        cursorclass=pymysql.cursors.DictCursor,
    )


def projetos_reais(usuario_id):
    """Devolve (X, y) com os projetos concluídos do usuário, ou (None, None) se não houver."""
    conexao = _conectar()
    try:
        with conexao.cursor() as cursor:
            cursor.execute(SQL, (usuario_id,))
            linhas = cursor.fetchall()
    finally:
        conexao.close()

    # só entram projetos com características válidas (itens, unidades e atividades > 0)
    validas = [l for l in linhas if l['n_itens'] > 0 and l['qtd_total'] > 0 and l['n_atividades'] > 0]
    if not validas:
        return None, None

    X = np.array([[l['n_itens'], l['qtd_total'], l['n_atividades'], l['prazo_dias']] for l in validas], dtype=float)
    y = np.array([l['funcionarios_usados'] for l in validas], dtype=float)
    return X, y
