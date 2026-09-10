const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'marketplace',
});

// Função auxiliar para montar a estrutura completa do payload do pedido
async function buildOrderPayload(orderRow) {
  const customer = await pool.query('SELECT * FROM cliente WHERE id = $1', [orderRow.id_cliente]);
  const seller = await pool.query('SELECT * FROM seller WHERE id = $1', [orderRow.id_seller]);
  const shipment = await pool.query('SELECT * FROM envio WHERE id_pedido = $1', [orderRow.uuid]);
  const payment = await pool.query('SELECT * FROM pagamento WHERE id_pedido = $1', [orderRow.uuid]);

  const itemsQuery = await pool.query(
    `SELECT ip.*, p.titulo, p.id_categoria, c.nome as cat_nome, c.id_subcategoria 
     FROM item_pedido ip
     JOIN produto p ON ip.id_produto = p.id
     LEFT JOIN categoria c ON p.id_categoria = c.id
     WHERE ip.id_pedido = $1`,
    [orderRow.uuid]
  );

  let totalPedido = 0;
  const itemsFormatted = itemsQuery.rows.map(item => {
    const itemTotal = Number(item.preco_unitario) * Number(item.quantidade);
    totalPedido += itemTotal;

    return {
      id: item.id,
      product: {
        id: item.id_produto,
        title: item.titulo,
        'unit price': Number(item.preco_unitario)
      },
      quantity: item.quantidade,
      category: {
        id: item.id_categoria,
        name: item.cat_nome,
        'sub category': item.id_subcategoria ? { id: item.id_subcategoria, name: '' } : null
      },
      total: itemTotal
    };
  });

  const ship = shipment.rows[0];
  const pay = payment.rows[0];
  const cust = customer.rows[0];
  const sel = seller.rows[0];

  return {
    uuid: orderRow.uuid,
    'created at': orderRow.data_criacao,
    channel: orderRow.canal,
    total: totalPedido,
    status: orderRow.status,
    customer: cust ? { id: cust.id, name: cust.nome, email: cust.email, document: cust.documento } : null,
    seller: sel ? { id: sel.id, name: sel.nome, city: sel.cidade, state: sel.estado } : null,
    items: itemsFormatted,
    shipment: ship ? { carrier: ship.transportadora, service: ship.servico, status: ship.status, tracking_code: ship.codigo_rastreio } : null,
    payment: pay ? { method: pay.metodo, status: pay.status, 'transaction id': pay.id_transacao } : null
  };
}

// 1. GET /orders (Com filtros, paginação e ordenação por data)
app.get('/orders', async (req, res) => {
  try {
    const { customer_id, product_id, status, seller_id, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let query = `SELECT DISTINCT p.* FROM pedido p 
                 LEFT JOIN item_pedido ip ON p.uuid = ip.id_pedido 
                 WHERE 1=1`;
    const params = [];

    if (customer_id) {
      params.push(customer_id);
      query += ` AND p.id_cliente = $${params.length}`;
    }
    if (seller_id) {
      params.push(seller_id);
      query += ` AND p.id_seller = $${params.length}`;
    }
    if (status) {
      params.push(status);
      query += ` AND p.status = $${params.length}`;
    }
    if (product_id) {
      params.push(product_id);
      query += ` AND ip.id_produto = $${params.length}`;
    }

    query += ` ORDER BY p.data_criacao DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const ordersResult = await pool.query(query, params);
    const responsePayloads = await Promise.all(ordersResult.rows.map(row => buildOrderPayload(row)));

    res.json(responsePayloads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /orders/{uuid}
app.get('/orders/:uuid', async (req, res) => {
  try {
    const orderResult = await pool.query('SELECT * FROM pedido WHERE uuid = $1', [req.params.uuid]);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }
    const payload = await buildOrderPayload(orderResult.rows[0]);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. GET /orders/{uuid}/items (Retorna apenas a estrutura de items do pedido)
app.get('/orders/:uuid/items', async (req, res) => {
  try {
    const orderResult = await pool.query('SELECT * FROM pedido WHERE uuid = $1', [req.params.uuid]);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }
    const payload = await buildOrderPayload(orderResult.rows[0]);
    res.json({ items: payload.items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. GET /orders/financial-summary
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

    const totalOrdersRes = await pool.query(`SELECT COUNT(*) FROM pedido p ${whereClause}`, params);
    const totalOrders = parseInt(totalOrdersRes.rows[0].count);

    const revenueRes = await pool.query(
      `SELECT SUM(ip.quantidade * ip.preco_unitario) as revenue 
       FROM pedido p 
       JOIN item_pedido ip ON p.uuid = ip.id_pedido 
       ${whereClause}`,
      params
    );
    const totalRevenue = parseFloat(revenueRes.rows[0].revenue || 0);
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const statusRes = await pool.query(
      `SELECT status, COUNT(*) as count FROM pedido p ${whereClause} GROUP BY status`,
      params
    );
    const byStatus = {};
    statusRes.rows.forEach(r => { byStatus[r.status] = parseInt(r.count); });

    const paymentRes = await pool.query(
      `SELECT pay.metodo, COUNT(p.uuid) as count, SUM(ip.quantidade * ip.preco_unitario) as total
       FROM pedido p
       JOIN pagamento pay ON p.uuid = pay.id_pedido
       JOIN item_pedido ip ON p.uuid = ip.id_pedido
       ${whereClause}
       GROUP BY pay.metodo`,
      params
    );
    const byPaymentMethod = {};
    paymentRes.rows.forEach(r => {
      byPaymentMethod[r.metodo] = {
        count: parseInt(r.count),
        total: parseFloat(r.total || 0)
      };
    });

    res.json({
      "total orders": totalOrders,
      "total revenue": totalRevenue,
      "average order value": averageOrderValue,
      "by_status": byStatus,
      "by_payment_method": byPaymentMethod
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});