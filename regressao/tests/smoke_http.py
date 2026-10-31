"""Teste de fumaça HTTP, rodado DENTRO do container (no CI: docker compose exec regressao ...).

O serviço não publica porta, então a chamada é feita para localhost, de dentro dele, com a
INTERNAL_API_KEY do ambiente. Confere: sem chave = 403, entrada inválida = 400 e uma
previsão válida devolve um número.
"""
import json
import os
import sys
import urllib.error
import urllib.request

PORTA = os.environ.get('PORT_REGRESSAO', '6000')
URL = f'http://localhost:{PORTA}/prever'
CHAVE = os.environ.get('INTERNAL_API_KEY', '')
CORPO = {'usuario_id': 1, 'n_itens': 20, 'qtd_total': 100, 'n_atividades': 2, 'prazo_dias': 30}


def chamar(corpo, com_chave=True):
    cabecalhos = {'Content-Type': 'application/json'}
    if com_chave:
        cabecalhos['x-internal-key'] = CHAVE
    pedido = urllib.request.Request(URL, data=json.dumps(corpo).encode(), headers=cabecalhos, method='POST')
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

status, _ = chamar(CORPO, com_chave=False)
exigir(status == 403, 'sem chave interna -> 403')

status, _ = chamar({**CORPO, 'n_itens': 0})
exigir(status == 400, 'entrada inválida -> 400')

status, corpo = chamar(CORPO)
exigir(status == 200, 'previsão válida -> 200')
exigir(isinstance(corpo.get('funcionarios_previstos'), (int, float)), 'devolve funcionarios_previstos numérico')
exigir(corpo['funcionarios_previstos'] >= 1, 'previsão >= 1 funcionário')
print('Regressão OK:', corpo)
