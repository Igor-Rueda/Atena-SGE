import base64
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import app as servico  # noqa: E402
import csv_util  # noqa: E402
import modelo  # noqa: E402


def csv_de_historico(linhas=12, separador=';', decimal=','):
    """funcionarios = 1 + 0,02 * itens + 0,003 * horas, exato, para conferir os coeficientes."""
    saida = [separador.join(['mes', 'funcionarios', 'itens_concluidos', 'horas_totais'])]
    for i in range(linhas):
        itens = 100 + 17 * i
        horas = round(800 + 63.5 * i + (i % 3) * 40, 1)
        funcionarios = 1 + 0.02 * itens + 0.003 * horas
        saida.append(separador.join([f'2024-{i + 1:02d}', f'{funcionarios:.6f}'.replace('.', decimal),
                                     str(itens), f'{horas:.1f}'.replace('.', decimal)]))
    return '\n'.join(saida)


def em_base64(texto):
    return base64.b64encode(texto.encode('utf-8')).decode()


class TesteCsv(unittest.TestCase):
    def test_numeros_em_varios_formatos(self):
        self.assertEqual(csv_util.para_numero('412'), 412.0)
        self.assertEqual(csv_util.para_numero('412,5'), 412.5)
        self.assertEqual(csv_util.para_numero('412.5'), 412.5)
        self.assertEqual(csv_util.para_numero('1.234,5'), 1234.5)
        self.assertEqual(csv_util.para_numero('1,234.5'), 1234.5)
        self.assertIsNone(csv_util.para_numero(''))
        self.assertIsNone(csv_util.para_numero('2024-01'))
        self.assertIsNone(csv_util.para_numero('abc'))

    def test_detecta_separador_do_excel_brasileiro_e_americano(self):
        self.assertEqual(csv_util.detectar_delimitador('a;b;c\n1;2;3'), ';')
        self.assertEqual(csv_util.detectar_delimitador('a,b,c\n1,2,3'), ',')

    def test_aceita_bom_utf8_e_ansi(self):
        com_bom = b'\xef\xbb\xbf' + 'mês;valor\n1;2'.encode('utf-8')
        ansi = 'mês;valor\n1;2'.encode('cp1252')
        self.assertTrue(csv_util.decodificar(base64.b64encode(com_bom).decode()).startswith('mês'))
        self.assertTrue(csv_util.decodificar(base64.b64encode(ansi).decode()).startswith('mês'))

    def test_rejeita_xlsx_e_arquivo_vazio(self):
        with self.assertRaises(csv_util.ErroCSV):
            csv_util.decodificar(base64.b64encode(b'PK\x03\x04conteudo').decode())
        with self.assertRaises(csv_util.ErroCSV):
            csv_util.decodificar('')

    def test_descreve_colunas_e_sugere_papeis(self):
        tabela = csv_util.ler_tabela(csv_de_historico())
        colunas = {c['nome']: c for c in csv_util.descrever_colunas(tabela)}
        self.assertFalse(colunas['mes']['numerica'])
        self.assertEqual(colunas['mes']['sugestao'], 'ignorar')
        self.assertEqual(colunas['funcionarios']['sugestao'], 'alvo')
        self.assertEqual(colunas['itens_concluidos']['sugestao'], 'entrada')
        self.assertTrue(colunas['horas_totais']['numerica'])

    def test_extrai_matriz_e_valida_escolhas(self):
        tabela = csv_util.ler_tabela(csv_de_historico())
        X, y, descartadas = csv_util.extrair_matriz(tabela, 'funcionarios', ['itens_concluidos', 'horas_totais'])
        self.assertEqual(len(X), 12)
        self.assertEqual(len(y), 12)
        self.assertEqual(descartadas, 0)
        with self.assertRaises(csv_util.ErroCSV):
            csv_util.extrair_matriz(tabela, 'funcionarios', ['funcionarios'])
        with self.assertRaises(csv_util.ErroCSV):
            csv_util.extrair_matriz(tabela, 'nao_existe', ['horas_totais'])
        with self.assertRaises(csv_util.ErroCSV):
            csv_util.extrair_matriz(tabela, 'funcionarios', [])
        with self.assertRaises(csv_util.ErroCSV):
            csv_util.extrair_matriz(tabela, 'funcionarios', ['mes'])  # coluna de texto


class TesteModelo(unittest.TestCase):
    def _treinar(self, **opcoes):
        tabela = csv_util.ler_tabela(csv_de_historico(**opcoes))
        X, y, _ = csv_util.extrair_matriz(tabela, 'funcionarios', ['itens_concluidos', 'horas_totais'])
        return modelo.treinar(X, y, ['itens_concluidos', 'horas_totais'])

    def test_recupera_os_coeficientes_de_uma_relacao_exata(self):
        resultado = self._treinar()
        coef = {c['nome']: c['valor'] for c in resultado['coeficientes']}
        self.assertAlmostEqual(resultado['intercepto'], 1.0, places=3)
        self.assertAlmostEqual(coef['itens_concluidos'], 0.02, places=4)
        self.assertAlmostEqual(coef['horas_totais'], 0.003, places=4)
        self.assertGreater(resultado['metricas']['r2'], 0.9999)

    def test_funciona_com_csv_de_virgula(self):
        resultado = self._treinar(separador=',', decimal='.')
        self.assertGreater(resultado['metricas']['r2'], 0.9999)

    def test_poucas_linhas_sao_recusadas(self):
        with self.assertRaises(modelo.ErroModelo):
            modelo.treinar([[1, 2], [2, 3], [3, 5]], [1, 2, 3], ['a', 'b'])

    def test_colunas_redundantes_sao_recusadas(self):
        X = [[i, 2 * i] for i in range(1, 13)]  # a segunda é o dobro da primeira
        with self.assertRaises(modelo.ErroModelo):
            modelo.treinar(X, list(range(1, 13)), ['a', 'b'])

    def test_previsao_arredonda_para_cima_e_avisa_fora_da_faixa(self):
        resultado = self._treinar()
        dentro = modelo.prever(resultado, {'itens_concluidos': 150, 'horas_totais': 1000})
        esperado = 1 + 0.02 * 150 + 0.003 * 1000
        self.assertAlmostEqual(dentro['previsto'], esperado, places=2)
        self.assertEqual(dentro['funcionarios'], int(esperado) + 1)
        self.assertEqual(dentro['fora_da_faixa'], [])
        fora = modelo.prever(resultado, {'itens_concluidos': 99999, 'horas_totais': 1000})
        self.assertIn('itens_concluidos', fora['fora_da_faixa'])

    def test_previsao_exige_todos_os_valores(self):
        resultado = self._treinar()
        with self.assertRaises(modelo.ErroModelo):
            modelo.prever(resultado, {'itens_concluidos': 100})
        with self.assertRaises(modelo.ErroModelo):
            modelo.prever(resultado, {'itens_concluidos': -1, 'horas_totais': 10})


class TesteAPI(unittest.TestCase):
    def setUp(self):
        self.cliente = servico.app.test_client()
        self.cabecalho = {'x-internal-key': 'chave-de-teste'}
        patcher = mock.patch.dict(os.environ, {'INTERNAL_API_KEY': 'chave-de-teste'})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_sem_chave_responde_403(self):
        self.assertEqual(self.cliente.post('/csv/previa', json={}).status_code, 403)
        self.assertEqual(self.cliente.get('/modelo?usuario_id=1').status_code, 403)

    def test_previa_devolve_colunas_e_linhas(self):
        resposta = self.cliente.post('/csv/previa', json={'arquivo_base64': em_base64(csv_de_historico())}, headers=self.cabecalho)
        self.assertEqual(resposta.status_code, 200)
        corpo = resposta.get_json()
        self.assertEqual(corpo['total_linhas'], 12)
        self.assertEqual([c['nome'] for c in corpo['colunas']], ['mes', 'funcionarios', 'itens_concluidos', 'horas_totais'])
        self.assertEqual(len(corpo['previa']), 8)

    def test_previa_de_arquivo_invalido_responde_400(self):
        resposta = self.cliente.post('/csv/previa', json={'arquivo_base64': ''}, headers=self.cabecalho)
        self.assertEqual(resposta.status_code, 400)
        self.assertIn('mensagem', resposta.get_json())

    def test_treinar_salva_e_devolve_o_resumo(self):
        corpo = {'usuario_id': 7, 'nome_arquivo': 'historico.csv', 'arquivo_base64': em_base64(csv_de_historico()),
                 'alvo': 'funcionarios', 'entradas': ['itens_concluidos', 'horas_totais']}
        with mock.patch.object(servico.dados, 'salvar_modelo') as salvar:
            resposta = self.cliente.post('/treinar', json=corpo, headers=self.cabecalho)
        self.assertEqual(resposta.status_code, 200)
        resumo = resposta.get_json()
        self.assertGreater(resumo['metricas']['r2'], 0.999)
        self.assertEqual(resumo['n_linhas'], 12)
        salvar.assert_called_once()

    def test_treinar_com_escolha_invalida_responde_400(self):
        corpo = {'usuario_id': 7, 'arquivo_base64': em_base64(csv_de_historico()),
                 'alvo': 'funcionarios', 'entradas': ['funcionarios']}
        self.assertEqual(self.cliente.post('/treinar', json=corpo, headers=self.cabecalho).status_code, 400)

    def test_prever_sem_modelo_responde_404(self):
        with mock.patch.object(servico.dados, 'carregar_modelo', return_value=None):
            resposta = self.cliente.post('/prever', json={'usuario_id': 7, 'valores': {'a': 1}}, headers=self.cabecalho)
        self.assertEqual(resposta.status_code, 404)

    def test_prever_com_modelo(self):
        tabela = csv_util.ler_tabela(csv_de_historico())
        X, y, _ = csv_util.extrair_matriz(tabela, 'funcionarios', ['itens_concluidos', 'horas_totais'])
        parametros = modelo.treinar(X, y, ['itens_concluidos', 'horas_totais'])
        with mock.patch.object(servico.dados, 'carregar_modelo', return_value=parametros):
            resposta = self.cliente.post('/prever', json={'usuario_id': 7, 'valores': {'itens_concluidos': 150, 'horas_totais': 1000}},
                                         headers=self.cabecalho)
        self.assertEqual(resposta.status_code, 200)
        self.assertGreaterEqual(resposta.get_json()['funcionarios'], 1)

    def test_banco_fora_do_ar_responde_503(self):
        with mock.patch.object(servico.dados, 'carregar_modelo', side_effect=RuntimeError('sem banco')):
            resposta = self.cliente.get('/modelo?usuario_id=7', headers=self.cabecalho)
        self.assertEqual(resposta.status_code, 503)


if __name__ == '__main__':
    unittest.main()
