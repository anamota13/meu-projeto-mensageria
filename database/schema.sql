CREATE TABLE IF NOT EXISTS cliente (
    id INT PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    documento VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS seller (
    id INT PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    cidade VARCHAR(100),
    estado VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS categoria (
    id VARCHAR(50) PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    id_subcategoria VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS produto (
    id VARCHAR(50) PRIMARY KEY,
    titulo VARCHAR(255) NOT NULL,
    preco_unitario DECIMAL(10,2) NOT NULL,
    id_categoria VARCHAR(50) REFERENCES categoria(id)
);

CREATE TABLE IF NOT EXISTS pedido (
    uuid VARCHAR(100) PRIMARY KEY,
    data_criacao TIMESTAMP NOT NULL,
    canal VARCHAR(50),
    status VARCHAR(50) NOT NULL,
    id_cliente INT NOT NULL REFERENCES cliente(id),
    id_seller INT NOT NULL REFERENCES seller(id),
    data_indexacao_mensageria TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS item_pedido (
    id SERIAL PRIMARY KEY,
    id_pedido VARCHAR(100) NOT NULL REFERENCES pedido(uuid),
    id_produto VARCHAR(50) NOT NULL REFERENCES produto(id),
    quantidade INT NOT NULL,
    preco_unitario DECIMAL(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS envio (
    id SERIAL PRIMARY KEY,
    id_pedido VARCHAR(100) NOT NULL REFERENCES pedido(uuid),
    transportadora VARCHAR(100),
    servico VARCHAR(50),
    status VARCHAR(50),
    codigo_rastreio VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS pagamento (
    id SERIAL PRIMARY KEY,
    id_pedido VARCHAR(100) NOT NULL REFERENCES pedido(uuid),
    metodo VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL,
    id_transacao VARCHAR(100)
);