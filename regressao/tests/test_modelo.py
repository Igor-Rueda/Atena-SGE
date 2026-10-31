import os
import sys
import unittest
from unittest import mock

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import app as servico  # noqa: E402
import modelo  # noqa: E402

CARACTERISTICAS = {'n_itens': 20, 'qtd_total': 100, 'n_atividades': 2, 'prazo_dias': 30}


class TesteModelo(unittest.TestCase):
    def test_exemplos_sao_deterministicos_e_validos(self):
        X1, y1 = modelo.gerar_exemplos()
        X2, y2 = modelo.gerar_exemplos()
        self.assertTrue(np.array_equal(X1, X2))
        self.assertTrue(np.array_equal(y1, y2))
        self.assertEqual(X1.shape, (40, 4))
        self.assertTrue((y1 >= 1).all())
        self.assertTrue(((X1[:, 2] >= 1) & (X1[:, 2] <= 3)).all())

    def test_sem_historico_real_usa_so_exemplos(self):
        resultado = modelo.prever(modelo.treinar(), CARACTERISTICAS)
        self.assertEqual(resultado['amostras_reais'], 0)
        self.assertEqual(resultado['amostras_exemplo'], 40)
        self.assertGreaterEqual(resultado['funcionarios_previstos'], 1)
        self.assertGreater(resultado['r2'], 0.7)  # os exemplos seguem uma relação clara

    def test_mais_atividades_e_mais_itens_pedem_mais_gente(self):
        m = modelo.treinar()
        pequeno = modelo.prever(m, {'n_itens': 10, 'qtd_total': 50, 'n_atividades': 1, 'prazo_dias': 60})
        grande = modelo.prever(m, {'n_itens': 55, 'qtd_total': 500, 'n_atividades': 3, 'prazo_dias': 10})
        self.assertGreater(grande['funcionarios_previstos'], pequeno['funcionarios_previstos'])

    def test_historico_real_domina_o_modelo(self):
        # projetos reais desta fábrica sempre usaram ~12 pessoas, bem acima dos exemplos (~4)
        rng = np.random.default_rng(7)
        X = np.column_stack([
            rng.integers(5, 40, 30), rng.integers(30, 300, 30),
            rng.integers(1, 4, 30), rng.integers(10, 60, 30),
        ]).astype(float)
        y = np.full(30, 12.0)

        sem = modelo.prever(modelo.treinar(), CARACTERISTICAS)['funcionarios_previstos']
        com = modelo.prever(modelo.treinar(X, y), CARACTERISTICAS)
        self.assertEqual(com['amostras_reais'], 30)
        self.assertGreater(com['funcionarios_previstos'], 9)
        self.assertGreater(com['funcionarios_previstos'], sem + 4)

    def test_recupera_relacao_linear_exata(self):
        rng = np.random.default_rng(1)
        X = np.column_stack([
            rng.integers(5, 60, 200), rng.integers(20, 600, 200),
            rng.integers(1, 4, 200), rng.integers(5, 90, 200),
        ]).astype(float)
        y = 2 + 0.1 * X[:, 0] + 0.01 * X[:, 1] + 1.5 * X[:, 2] - 0.03 * X[:, 3]
        # tira o peso dos exemplos para isolar o ajuste: muitos reais => exemplos quase sem peso
        m = modelo.treinar(X, y)
        esperado = 2 + 0.1 * 20 + 0.01 * 100 + 1.5 * 2 - 0.03 * 30
        previsto = modelo.prever(m, CARACTERISTICAS)['funcionarios_previstos']
        self.assertAlmostEqual(previsto, esperado, delta=0.6)

    def test_avisa_quando_extrapola(self):
        resultado = modelo.prever(modelo.treinar(), {'n_itens': 5000, 'qtd_total': 100, 'n_atividades': 2, 'prazo_dias': 30})
        self.assertIn('n_itens', resultado['fora_da_faixa'])

    def test_previsao_nunca_abaixo_de_1(self):
        resultado = modelo.prever(modelo.treinar(), {'n_itens': 1, 'qtd_total': 1, 'n_atividades': 1, 'prazo_dias': 3650})
        self.assertGreaterEqual(resultado['funcionarios_previstos'], 1)


class TesteAPI(unittest.TestCase):
    def setUp(self):
        self.cliente = servico.app.test_client()
        self.cabecalho = {'x-internal-key': 'chave-de-teste'}
        self.corpo = {'usuario_id': 1, **CARACTERISTICAS}
        patcher = mock.patch.dict(os.environ, {'INTERNAL_API_KEY': 'chave-de-teste'})
        patcher.start()
        self.addCleanup(patcher.stop)

    def _post(self, corpo=None, cabecalho=None):
        return self.cliente.post('/prever', json=self.corpo if corpo is None else corpo,
                                 headers=self.cabecalho if cabecalho is None else cabecalho)

    def test_health(self):
        self.assertEqual(self.cliente.get('/health').status_code, 200)

    def test_sem_chave_ou_chave_errada_responde_403(self):
        self.assertEqual(self._post(cabecalho={}).status_code, 403)
        self.assertEqual(self._post(cabecalho={'x-internal-key': 'errada'}).status_code, 403)

    def test_sem_variavel_de_ambiente_nada_passa(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(self._post().status_code, 403)

    def test_entradas_invalidas_respondem_400(self):
        casos = [
            {**self.corpo, 'n_itens': 0},
            {**self.corpo, 'n_atividades': 4},
            {**self.corpo, 'n_atividades': 1.5},
            {**self.corpo, 'prazo_dias': 'abc'},
            {**self.corpo, 'usuario_id': 0},
            {k: v for k, v in self.corpo.items() if k != 'qtd_total'},
        ]
        for corpo in casos:
            with self.subTest(corpo=corpo):
                self.assertEqual(self._post(corpo=corpo).status_code, 400)

    def test_previsao_com_historico(self):
        X = np.array([[10, 60, 2, 20], [30, 200, 3, 40], [15, 90, 1, 25], [40, 300, 3, 30], [8, 40, 1, 15]], dtype=float)
        y = np.array([5, 9, 3, 11, 2], dtype=float)
        with mock.patch.object(servico.dados, 'projetos_reais', return_value=(X, y)):
            resposta = self._post()
        self.assertEqual(resposta.status_code, 200)
        corpo = resposta.get_json()
        self.assertEqual(corpo['amostras_reais'], 5)
        self.assertFalse(corpo['historico_indisponivel'])
        self.assertIsInstance(corpo['funcionarios_previstos'], float)

    def test_banco_fora_do_ar_responde_com_exemplos_e_avisa(self):
        with mock.patch.object(servico.dados, 'projetos_reais', side_effect=RuntimeError('sem banco')):
            resposta = self._post()
        self.assertEqual(resposta.status_code, 200)
        corpo = resposta.get_json()
        self.assertTrue(corpo['historico_indisponivel'])
        self.assertEqual(corpo['amostras_reais'], 0)


if __name__ == '__main__':
    unittest.main()
