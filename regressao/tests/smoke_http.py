"""Teste de fumaça HTTP, rodado DENTRO do container (no CI: docker compose exec regressao ...).

O serviço não publica porta, então a chamada é feita para localhost, de dentro dele, com a
INTERNAL_API_KEY do ambiente. Confere: sem chave = 403, prévia de um CSV pequeno = 200 e
um usuário sem modelo = 404. Não grava nada no banco.
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request

PORTA = os.environ.get('PORT_REGRESSAO', '6001')
BASE = f'http://localhost:{PORTA}'
CHAVE = os.environ.get('INTERNAL_API_KEY', '')
CSV = 'mes;funcionarios;itens;horas\n2024-01;5;100;800,5\n2024-02;6;120;900\n2024-03;7;140;1000,5\n'


def chamar(metodo, caminho, corpo=None, com_chave=True):
    cabecalhos = {'Content-Type': 'application/json'}
    if com_chave:
        cabecalhos['x-internal-key'] = CHAVE
    dados = json.dumps(corpo).encode() if corpo is not None else None
    pedido = urllib.request.Request(BASE + caminho, data=dados, headers=cabecalhos, method=metodo)
    try:
        with urllib.request.urlopen(pedido, timeout=10) as resposta:
            return resposta.status, json.loads(resposta.read())
    except urllib.error.HTTPError as erro:
        return erro.code, json.loads(erro.read() or b'{}')


def exigir(condicao, texto):
    print(('ok    ' if condicao else 'FALHOU'), texto)
    if not condicao:
        sys.exit(1)


if not CHAVE:
    print('FALHOU INTERNAL_API_KEY ausente do ambiente do container')
    sys.exit(1)

status, _ = chamar('GET', '/health', com_chave=False)
exigir(status == 200, 'health responde 200')

status, _ = chamar('POST', '/csv/previa', {'arquivo_base64': ''}, com_chave=False)
exigir(status == 403, 'sem chave interna -> 403')

arquivo = base64.b64encode(CSV.encode()).decode()
status, corpo = chamar('POST', '/csv/previa', {'arquivo_base64': arquivo})
exigir(status == 200, 'prévia de um CSV pequeno -> 200')
exigir([c['nome'] for c in corpo['colunas']] == ['mes', 'funcionarios', 'itens', 'horas'], 'colunas lidas na ordem do arquivo')
exigir(corpo['colunas'][1]['sugestao'] == 'alvo', 'coluna "funcionarios" sugerida como alvo')

status, _ = chamar('GET', '/modelo?usuario_id=999999')
exigir(status == 404, 'usuário sem modelo -> 404')
print('Regressão OK')
