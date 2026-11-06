"""Guarda o modelo treinado de cada usuário no MariaDB (tabela modelos_regressao)."""
import json
import os

import pymysql

RECURSO = 'previsao_equipe'


def _conectar():
    porta = int(os.environ.get('DB_PORT', 3306))
    return pymysql.connect(
        host=os.environ.get('DB_HOST'),
        port=porta,
        user=os.environ.get('DB_USER'),
        password=os.environ.get('DB_PASSWORD'),
        database=os.environ.get('DB_NAME'),
        connect_timeout=3,
        read_timeout=5,
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )


def salvar_modelo(usuario_id, nome_arquivo, alvo, resultado):
    conexao = _conectar()
    try:
        with conexao.cursor() as cursor:
            cursor.execute(
                """INSERT INTO modelos_regressao (usuario_id, recurso, nome_arquivo, alvo, n_linhas, resultado)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON DUPLICATE KEY UPDATE nome_arquivo = VALUES(nome_arquivo), alvo = VALUES(alvo),
                     n_linhas = VALUES(n_linhas), resultado = VALUES(resultado), treinado_em = CURRENT_TIMESTAMP""",
                (usuario_id, RECURSO, (nome_arquivo or '')[:200], alvo[:100], resultado['n_linhas'], json.dumps(resultado)),
            )
    finally:
        conexao.close()


def carregar_modelo(usuario_id):
    """Devolve o resumo completo do modelo do usuário, ou None se ele ainda não treinou nenhum."""
    conexao = _conectar()
    try:
        with conexao.cursor() as cursor:
            cursor.execute(
                'SELECT nome_arquivo, alvo, resultado FROM modelos_regressao WHERE usuario_id = %s AND recurso = %s',
                (usuario_id, RECURSO),
            )
            linha = cursor.fetchone()
    finally:
        conexao.close()
    if not linha:
        return None
    resultado = json.loads(linha['resultado'])
    resultado['nome_arquivo'] = linha['nome_arquivo']
    resultado['alvo'] = linha['alvo']
    return resultado


def apagar_modelo(usuario_id):
    conexao = _conectar()
    try:
        with conexao.cursor() as cursor:
            return cursor.execute('DELETE FROM modelos_regressao WHERE usuario_id = %s AND recurso = %s', (usuario_id, RECURSO))
    finally:
        conexao.close()
