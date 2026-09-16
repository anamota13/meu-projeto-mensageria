# Meu Projeto Mensageria - Marketplace Event-Driven Architecture

Este projeto é um sistema de mensageria assíncrono orientado a eventos para processamento de pedidos de marketplace. Ele consome dados do **Google Cloud Pub/Sub**, armazena as informações em um banco relacional **PostgreSQL** com isolamento de transações e disponibiliza endpoints de consulta e relatórios via uma **API RESTful** em Node.js com cálculos dinâmicos em tempo de execução.

---

## Integrantes do Grupo

- **Ana Júlia Alves Mota** — RA: `1091392413021`
- **Lauane Gabriela de Araújo Toledo** — RA: `1091392413054`
- **Pedro Henrique Cintra Silva** — RA: `1091392413013`

---

## Arquitetura do Sistema

### 1. Google Cloud Pub/Sub (Broker)

Recebe os eventos e payloads dos pedidos do marketplace.

### 2. Consumidor (`consumer.js`)

Escuta a subscrição Pub/Sub do GCP, abre transações ACID no PostgreSQL e armazena os dados de forma relacional.

### 3. PostgreSQL (Docker)

Banco de dados relacional, disponibilizado na porta `5433`, contendo as 8 tabelas normalizadas:

- Cliente
- Seller
- Categoria
- Produto
- Pedido
- Item do pedido
- Envio
- Pagamento

### 4. API RESTful (`server.js`)

Servidor HTTP Express, disponibilizado na porta `3000`, com endpoints de listagem, consulta por UUID e resumo financeiro.

---

## Como Executar o Projeto

### Pré-requisitos

- Docker e Docker Desktop instalados
- Node.js v18+ instalado

---

### 1. Subir o Banco de Dados (PostgreSQL via Docker)

Na raiz do projeto, execute:

```bash
docker compose up -d
```

O banco subirá na porta `5433`, criando automaticamente as tabelas a partir do script `database/schema.sql`.

---

### 2. Executar o Consumidor (Job de Mensageria)

Em um terminal, navegue até a pasta `consumer` e execute:

```bash
cd consumer
npm install
node src/consumer.js
```

O consumidor se conectará ao Google Pub/Sub e começará a persistir os pedidos recebidos.

---

### 3. Executar a API RESTful

Em outro terminal, navegue até a pasta `api` e execute:

```bash
cd api
npm install
node src/server.js
```

A API estará disponível em:

`http://localhost:3000`

---

## Testando os Endpoints

Você pode executar as requisições HTTP utilizando o arquivo `api.http`, localizado na raiz do projeto.

Recomenda-se utilizar a extensão **REST Client** do VS Code.

---

## Rotas Disponíveis

### 1. GET `/orders`

Listagem de pedidos com paginação (`page`, `limit`) e filtros por:

- `status`
- `customer_id`
- `seller_id`
- `product_id`

---

### 2. GET `/orders/financial-summary`

Consolidação financeira com:

- Faturamento total
- Ticket médio
- Agrupamento por status
- Agrupamento por forma de pagamento:
  - PIX
  - Cartão de crédito
  - Boleto

---

### 3. GET `/orders/:uuid`

Retorna os detalhes completos do pedido selecionado pelo UUID.

---

### 4. GET `/orders/:uuid/items`

Retorna apenas a estrutura e o cálculo dos itens do pedido.

---

## Modelo de Dados (DER)

O diagrama de entidade e relacionamento (DER), com o mapeamento das 8 tabelas e chaves estrangeiras, pode ser encontrado em:

`database/der-diagram.png`