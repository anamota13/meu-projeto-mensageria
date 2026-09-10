const amqp = require('amqplib');
const { Client } = require('pg');
require('dotenv').config();

// Configuração de conexão do PostgreSQL
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'marketplace',
};

async function runConsumer() {
  try {
    const db = new Client(dbConfig);
    await db.connect();

    const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
    const channel = await connection.createChannel();

    const queue = 'orders_queue';
    await channel.assertQueue(queue, { durable: true });

    console.log(`[*] Aguardando mensagens na fila '${queue}'...`);

    channel.consume(queue, async (msg) => {
      if (msg !== null) {
        const payload = JSON.parse(msg.content.toString());
        console.log(`[x] Pedido recebido: ${payload.uuid}`);

        try {
          await db.query('BEGIN');

          // A. Cliente
          await db.query(
            `INSERT INTO cliente (id, nome, email, documento) 
             VALUES ($1, $2, $3, $4) 
             ON CONFLICT (id) DO UPDATE SET nome = $2, email = $3, documento = $4`,
            [payload.customer.id, payload.customer.name, payload.customer.email, payload.customer.document]
          );

          // B. Seller
          await db.query(
            `INSERT INTO seller (id, nome, cidade, estado) 
             VALUES ($1, $2, $3, $4) 
             ON CONFLICT (id) DO UPDATE SET nome = $2, cidade = $3, estado = $4`,
            [payload.seller.id, payload.seller.name, payload.seller.city, payload.seller.state]
          );

          // C. Categoria e Produto
          for (const item of payload.items) {
            await db.query(
              `INSERT INTO categoria (id, nome, id_subcategoria) 
               VALUES ($1, $2, $3) 
               ON CONFLICT (id) DO UPDATE SET nome = $2, id_subcategoria = $3`,
              [
                item.category.id,
                item.category.name,
                item.category['sub category']?.id || null
              ]
            );

            await db.query(
              `INSERT INTO produto (id, titulo, preco_unitario, id_categoria) 
               VALUES ($1, $2, $3, $4) 
               ON CONFLICT (id) DO UPDATE SET titulo = $2, preco_unitario = $3, id_categoria = $4`,
              [
                item.product.id,
                item.product.title,
                item.product['unit price'],
                item.category.id
              ]
            );
          }

          // D. Pedido (com data de indexação da mensageria)
          const now = new Date();
          await db.query(
            `INSERT INTO pedido (uuid, data_criacao, canal, status, id_cliente, id_seller, data_indexacao_mensageria) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              payload.uuid,
              new Date(payload['created at']),
              payload.channel,
              payload.status,
              payload.customer.id,
              payload.seller.id,
              now
            ]
          );

          // E. Itens do Pedido
          for (const item of payload.items) {
            await db.query(
              `INSERT INTO item_pedido (id_pedido, id_produto, quantidade, preco_unitario) 
               VALUES ($1, $2, $3, $4)`,
              [
                payload.uuid,
                item.product.id,
                item.quantity,
                item.product['unit price']
              ]
            );
          }

          // F. Envio
          if (payload.shipment) {
            await db.query(
              `INSERT INTO envio (id_pedido, transportadora, servico, status, codigo_rastreio) 
               VALUES ($1, $2, $3, $4, $5)`,
              [
                payload.uuid,
                payload.shipment.carrier,
                payload.shipment.service,
                payload.shipment.status,
                payload.shipment.tracking_code
              ]
            );
          }

          // G. Pagamento
          if (payload.payment) {
            await db.query(
              `INSERT INTO pagamento (id_pedido, metodo, status, id_transacao) 
               VALUES ($1, $2, $3, $4)`,
              [
                payload.uuid,
                payload.payment.method,
                payload.payment.status,
                payload.payment['transaction id']
              ]
            );
          }

          await db.query('COMMIT');
          console.log(`[✓] Pedido ${payload.uuid} persistido com sucesso.`);
          channel.ack(msg);

        } catch (error) {
          await db.query('ROLLBACK');
          console.error(`[✗] Erro ao processar pedido ${payload.uuid}:`, error);
          channel.nack(msg, false, false);
        }
      }
    });

  } catch (error) {
    console.error('Erro na inicialização do consumidor:', error);
  }
}

runConsumer();