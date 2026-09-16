const { PubSub } = require('@google-cloud/pubsub');
const { Client } = require('pg');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5433,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'marketplace',
};

const pubsub = new PubSub({
  keyFilename: './sa-grupo-e-key.json',
  projectId: 'serjava-demo',
});

const subscription = pubsub.subscription('projects/serjava-demo/subscriptions/grupo-e');

async function runConsumer() {
  const db = new Client(dbConfig);

  try {
    await db.connect();
    console.log('[*] Conectado ao PostgreSQL.');
    console.log('[*] Aguardando mensagens no Google Pub/Sub...');

    subscription.on('message', async (msg) => {
      let payload;
      try {
        payload = JSON.parse(msg.data.toString());
        console.log(`[x] Pedido recebido: ${payload.uuid}`);

        await db.query('BEGIN');

        // A. Cliente
        await db.query(
          `INSERT INTO cliente (id, nome, email, documento) 
           VALUES ($1, $2, $3, $4) 
           ON CONFLICT (id) DO UPDATE SET nome = $2, email = $3, documento = $4`,
          [payload.customer.id, payload.customer.name, payload.customer.email, payload.customer.document]
        );

        // B. Seller
        if (payload.seller) {
          await db.query(
            `INSERT INTO seller (id, nome, cidade, estado) 
             VALUES ($1, $2, $3, $4) 
             ON CONFLICT (id) DO UPDATE SET nome = $2, cidade = $3, estado = $4`,
            [payload.seller.id, payload.seller.name, payload.seller.city, payload.seller.state]
          );
        }

        // C. Categorias e Produtos
        for (const item of payload.items) {
          const category = item.category;
          const subCategory = category ? (category['sub category'] || category.sub_category) : null;

          if (subCategory) {
            await db.query(
              `INSERT INTO categoria (id, nome, id_subcategoria) 
               VALUES ($1, $2, NULL) 
               ON CONFLICT (id) DO NOTHING`,
              [subCategory.id, subCategory.name]
            );
          }

          if (category) {
            await db.query(
              `INSERT INTO categoria (id, nome, id_subcategoria) 
               VALUES ($1, $2, $3) 
               ON CONFLICT (id) DO UPDATE SET nome = $2, id_subcategoria = $3`,
              [category.id, category.name, subCategory ? subCategory.id : null]
            );
          }

          const unitPrice = item['unit price'] || item.unit_price;

          await db.query(
            `INSERT INTO produto (id, titulo, preco_unitario, id_categoria) 
             VALUES ($1, $2, $3, $4) 
             ON CONFLICT (id) DO UPDATE SET titulo = $2, preco_unitario = $3, id_categoria = $4`,
            [item.product.id, item.product.title, unitPrice, category ? category.id : null]
          );
        }

        // D. Pedido (com data de indexação)
        const now = new Date();
        const createdAt = payload['created at'] || payload.created_at;

        await db.query(
          `INSERT INTO pedido (uuid, data_criacao, canal, status, id_cliente, id_seller, data_indexacao_mensageria) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (uuid) DO NOTHING`,
          [
            payload.uuid,
            new Date(createdAt),
            payload.channel,
            payload.status,
            payload.customer.id,
            payload.seller ? payload.seller.id : null,
            now
          ]
        );

        // E. Itens do Pedido
        for (const item of payload.items) {
          const unitPrice = item['unit price'] || item.unit_price;

          await db.query(
            `INSERT INTO item_pedido (id_pedido, id_produto, quantidade, preco_unitario) 
             VALUES ($1, $2, $3, $4)`,
            [payload.uuid, item.product.id, item.quantity, unitPrice]
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
          const transactionId = payload.payment['transaction id'] || payload.payment.transaction_id;

          await db.query(
            `INSERT INTO pagamento (id_pedido, metodo, status, id_transacao) 
             VALUES ($1, $2, $3, $4)`,
            [
              payload.uuid,
              payload.payment.method,
              payload.payment.status,
              transactionId
            ]
          );
        }

        await db.query('COMMIT');
        console.log(`[✓] Pedido ${payload.uuid} persistido com sucesso.`);
        msg.ack();

      } catch (error) {
        await db.query('ROLLBACK');
        console.error(`[✗] Erro ao processar pedido:`, error);
        msg.nack();
      }
    });

  } catch (error) {
    console.error('Erro no consumidor:', error);
  }
}

runConsumer();