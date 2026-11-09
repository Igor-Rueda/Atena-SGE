require('dotenv').config() // Lê as variáveis de ambiente

const express = require('express')
const routes = require('./routes.js')
const internal = require('./internal.js')

const app = express()

const PORTA = process.env.PORT_AUTH || 4000

// Este serviço não tem porta pública: quem chama é o app, que repassa o IP real do cliente em
// x-forwarded-for. Com 1 salto confiável, req.ip passa a ser o IP do cliente (e não o do app),
// o que faz o limite de tentativas valer por pessoa e não para o sistema inteiro.
app.set('trust proxy', 1)

app.use(express.json()) // Converte o corpo das requisições em JSON, acessível via req.body

app.use('/internos', internal) // rotas de uso exclusivo do catalogo (exigem INTERNAL_API_KEY)
app.use('/', routes) // Monta as rotas de auth direto na raiz (esse serviço inteiro é o auth)

app.listen(PORTA, () => {
  console.log(`Serviço de autenticação rodando na porta ${PORTA}`)
})