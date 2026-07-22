const express = require('express');
const fs = require('fs');
const path = require('path');
const { coffees, orders } = require('./data');

const logsDir = path.join(__dirname, 'logs');
const logFile = path.join(logsDir, 'requests.log');
const MAX_RECENT_LOGS = 200;
const recentLogs = [];

let logStream;

try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  logStream = fs.createWriteStream(logFile, { flags: 'a' });
} catch (error) {
  console.error('Unable to initialize log file. Falling back to stdout only.', error);
}

const logEvent = (event, details = {}) => {
  const record = {
    timestamp: new Date().toISOString(),
    event,
    ...details,
  };
  const line = JSON.stringify(record);
  recentLogs.push(record);
  if (recentLogs.length > MAX_RECENT_LOGS) {
    recentLogs.shift();
  }
  if (logStream) {
    logStream.write(line + '\n');
  }
  console.log(line);
};

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public')); 

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logEvent('http_request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });
  next();
});

app.get('/logs/data', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || MAX_RECENT_LOGS, MAX_RECENT_LOGS);
  const startIndex = Math.max(recentLogs.length - limit, 0);
  res.json({ logs: recentLogs.slice(startIndex) });
});

// Endpoint to check health status
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'coffee-delivery-api',
    version: process.env.APP_VERSION || 'unknown'
  });
});

// Endpoint to fetch available coffees
app.get('/coffees', (req, res) => {
  res.json(coffees);
});

// Endpoint to place an order
app.post('/order', (req, res) => {
  const { coffeeId, quantity } = req.body;

  const coffee = coffees.find(c => c.id === coffeeId);

  if (!coffee) {
    logEvent('order_failed', { reason: 'invalid_coffee', coffeeId });
    return res.status(400).json({ error: 'Invalid coffee ID' });
  }

  const order = {
    orderId: orders.length + 1,
    coffeeName: coffee.name,
    quantity,
    total: coffee.price * quantity
  };

  orders.push(order);

  logEvent('order_created', {
    orderId: order.orderId,
    coffeeId,
    quantity,
    total: order.total,
  });

  res.status(201).json(order);
});

// Endpoint to fetch all orders
app.get('/orders', (req, res) => {
  res.json(orders);
});

// Only start server if not in test mode
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    logEvent('service_started', { port: PORT });
    logEvent('health_endpoint', { url: `http://0.0.0.0:${PORT}/health` });
  });
}

module.exports = app;
