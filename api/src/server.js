const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(express.json());

// Conexão com o PostgreSQL rodando no Docker (Porta 5433)
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5433,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'marketplace',
});

// Função Utilitária: Formata a resposta e realiza o CÁLCULO DINÂMICO
function formatOrderResponse(orderRow, itemsRows, shipmentRow, paymentRow) {
  let orderTotal = 0;

  const items = itemsRows.map((item) => {
    const unitPrice = parseFloat(item.preco_unitario);
    const quantity = parseInt(item.quantidade, 10);
    const itemTotal = unitPrice * quantity; // Cálculo dinâmico do item
    orderTotal += itemTotal; // Soma dinamicamente para o total do pedido

    return {
      id: item.id_item,
      product: {
        id: item.id_produto,
        title: item.titulo_produto,
        'unit price': unitPrice,
        quantity: quantity,
        category: {
          id: item.id_categoria,
          name: item.nome_categoria,
          'sub category': item.id_subcategoria ? {
            id: item.id_subcategoria,
            name: item.nome_subcategoria
          } : null
        }
      },
      total: itemTotal // Valor calculado do item
    };
  });

  return {
    uuid: orderRow.uuid,
    'created at': orderRow.data_criacao,
    channel: orderRow.canal,
    total: orderTotal, // Valor total do pedido calculado dinamicamente
    status: orderRow.status,
    customer: {
      id: orderRow.id_cliente,
      name: orderRow.nome_cliente,
      email: orderRow.email_cliente,
      document: orderRow.documento_cliente
    },
    seller: {
      id: orderRow.id_seller,
      name: orderRow.nome_seller,
      city: orderRow.cidade_seller,
      state: orderRow.estado_seller
    },
    items: items,
    shipment: shipmentRow ? {
      carrier: shipmentRow.transportadora,
      service: shipmentRow.servico,
      status: shipmentRow.status,
      tracking_code: shipmentRow.codigo_rastreio
    } : null,
    payment: paymentRow ? {
      method: paymentRow.metodo,
      status: paymentRow.status,
      'transaction id': paymentRow.id_transacao
    } : null
  };
}

// 1. GET /orders - Listagem com Paginação e Filtros
app.get('/orders', async (req, res) => {
  try {
    const { page = 1, limit = 10, customer_id, product_id, status, seller_id } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT p.uuid, p.data_criacao, p.canal, p.status, 
             c.id as id_cliente, c.nome as nome_cliente, c.email as email_cliente, c.documento as documento_cliente,
             s.id as id_seller, s.nome as nome_seller, s.cidade as cidade_seller, s.estado as estado_seller
      FROM pedido p
      JOIN cliente c ON p.id_cliente = c.id
      JOIN seller s ON p.id_seller = s.id
      WHERE 1=1
    `;
    const params = [];

    if (customer_id) {
      params.push(customer_id);
      query += ` AND p.id_cliente = $${params.length}`;
    }
    if (status) {
      params.push(status);
      query += ` AND p.status = $${params.length}`;
    }
    if (seller_id) {
      params.push(seller_id);
      query += ` AND p.id_seller = $${params.length}`;
    }
    if (product_id) {
      params.push(product_id);
      query += ` AND p.uuid IN (SELECT id_pedido FROM item_pedido WHERE id_produto = $${params.length})`;
    }

    query += ` ORDER BY p.data_criacao DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const ordersResult = await pool.query(query, params);
    const response = [];

    for (const order of ordersResult.rows) {
      const itemsResult = await pool.query(`
        SELECT ip.id as id_item, ip.id_produto, pr.titulo as titulo_produto, ip.preco_unitario, ip.quantidade,
               cat.id as id_categoria, cat.nome as nome_categoria, sub.id as id_subcategoria, sub.nome as nome_subcategoria
        FROM item_pedido ip
        JOIN produto pr ON ip.id_produto = pr.id
        LEFT JOIN categoria cat ON pr.id_categoria = cat.id
        LEFT JOIN categoria sub ON cat.id_subcategoria = sub.id
        WHERE ip.id_pedido = $1
      `, [order.uuid]);

      const shipmentResult = await pool.query('SELECT * FROM envio WHERE id_pedido = $1', [order.uuid]);
      const paymentResult = await pool.query('SELECT * FROM pagamento WHERE id_pedido = $1', [order.uuid]);

      response.push(formatOrderResponse(order, itemsResult.rows, shipmentResult.rows[0], paymentResult.rows[0]));
    }

    res.json(response);
  } catch (error) {
    console.error('Erro em GET /orders:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// 2. GET /orders/financial-summary - Resumo Financeiro
app.get('/orders/financial-summary', async (req, res) => {
  try {
    const { seller_id, start_date, end_date } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (seller_id) {
      params.push(seller_id);
      whereClause += ` AND p.id_seller = $${params.length}`;
    }
    if (start_date && end_date) {
      params.push(start_date, end_date);
      whereClause += ` AND p.data_criacao BETWEEN $${params.length - 1} AND $${params.length}`;
    }

    const totalsQuery = `
      SELECT COUNT(DISTINCT p.uuid) as total_orders, 
             COALESCE(SUM(ip.quantidade * ip.preco_unitario), 0) as total_revenue
      FROM pedido p
      JOIN item_pedido ip ON p.uuid = ip.id_pedido
      ${whereClause}
    `;
    const totalsResult = await pool.query(totalsQuery, params);
    const totalOrders = parseInt(totalsResult.rows[0].total_orders, 10);
    const totalRevenue = parseFloat(totalsResult.rows[0].total_revenue);
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const statusQuery = `
      SELECT p.status, COUNT(p.uuid) as count
      FROM pedido p
      ${whereClause}
      GROUP BY p.status
    `;
    const statusResult = await pool.query(statusQuery, params);
    const byStatus = { pending: 0, approved: 0, shipped: 0, delivered: 0, canceled: 0 };
    statusResult.rows.forEach(row => {
      byStatus[row.status] = parseInt(row.count, 10);
    });

    const paymentQuery = `
      SELECT pg.metodo, COUNT(DISTINCT p.uuid) as count, SUM(ip.quantidade * ip.preco_unitario) as total
      FROM pedido p
      JOIN pagamento pg ON p.uuid = pg.id_pedido
      JOIN item_pedido ip ON p.uuid = ip.id_pedido
      ${whereClause}
      GROUP BY pg.metodo
    `;
    const paymentResult = await pool.query(paymentQuery, params);
    const byPaymentMethod = {
      pix: { count: 0, total: 0 },
      'credit card': { count: 0, total: 0 },
      boleto: { count: 0, total: 0 }
    };
    paymentResult.rows.forEach(row => {
      if (byPaymentMethod[row.metodo]) {
        byPaymentMethod[row.metodo] = {
          count: parseInt(row.count, 10),
          total: parseFloat(row.total)
        };
      }
    });

    res.json({
      'total orders': totalOrders,
      'total revenue': totalRevenue,
      'average order value': averageOrderValue,
      by_status: byStatus,
      by_payment_method: byPaymentMethod
    });
  } catch (error) {
    console.error('Erro em GET /orders/financial-summary:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// 3. GET /orders/:uuid - Detalhes do Pedido por UUID
app.get('/orders/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;

    const orderQuery = `
      SELECT p.uuid, p.data_criacao, p.canal, p.status, 
             c.id as id_cliente, c.nome as nome_cliente, c.email as email_cliente, c.documento as documento_cliente,
             s.id as id_seller, s.nome as nome_seller, s.cidade as cidade_seller, s.estado as estado_seller
      FROM pedido p
      JOIN cliente c ON p.id_cliente = c.id
      JOIN seller s ON p.id_seller = s.id
      WHERE p.uuid = $1
    `;
    const orderResult = await pool.query(orderQuery, [uuid]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    const order = orderResult.rows[0];

    const itemsResult = await pool.query(`
      SELECT ip.id as id_item, ip.id_produto, pr.titulo as titulo_produto, ip.preco_unitario, ip.quantidade,
             cat.id as id_categoria, cat.nome as nome_categoria, sub.id as id_subcategoria, sub.nome as nome_subcategoria
      FROM item_pedido ip
      JOIN produto pr ON ip.id_produto = pr.id
      LEFT JOIN categoria cat ON pr.id_categoria = cat.id
      LEFT JOIN categoria sub ON cat.id_subcategoria = sub.id
      WHERE ip.id_pedido = $1
    `, [uuid]);

    const shipmentResult = await pool.query('SELECT * FROM envio WHERE id_pedido = $1', [uuid]);
    const paymentResult = await pool.query('SELECT * FROM pagamento WHERE id_pedido = $1', [uuid]);

    res.json(formatOrderResponse(order, itemsResult.rows, shipmentResult.rows[0], paymentResult.rows[0]));
  } catch (error) {
    console.error('Erro em GET /orders/:uuid:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// 4. GET /orders/:uuid/items - Retorna apenas a estrutura de itens
app.get('/orders/:uuid/items', async (req, res) => {
  try {
    const { uuid } = req.params;

    const itemsResult = await pool.query(`
      SELECT ip.id as id_item, ip.id_produto, pr.titulo as titulo_produto, ip.preco_unitario, ip.quantidade,
             cat.id as id_categoria, cat.nome as nome_categoria, sub.id as id_subcategoria, sub.nome as nome_subcategoria
      FROM item_pedido ip
      JOIN produto pr ON ip.id_produto = pr.id
      LEFT JOIN categoria cat ON pr.id_categoria = cat.id
      LEFT JOIN categoria sub ON cat.id_subcategoria = sub.id
      WHERE ip.id_pedido = $1
    `, [uuid]);

    const items = itemsResult.rows.map((item) => {
      const unitPrice = parseFloat(item.preco_unitario);
      const quantity = parseInt(item.quantidade, 10);
      return {
        id: item.id_item,
        product: {
          id: item.id_produto,
          title: item.titulo_produto,
          'unit price': unitPrice,
          quantity: quantity,
          category: {
            id: item.id_categoria,
            name: item.nome_categoria,
            'sub category': item.id_subcategoria ? {
              id: item.id_subcategoria,
              name: item.nome_subcategoria
            } : null
          }
        },
        total: unitPrice * quantity
      };
    });

    res.json({ items });
  } catch (error) {
    console.error('Erro em GET /orders/:uuid/items:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API RESTful rodando na porta ${PORT}`);
});