const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = 8080;

// Enable CORS for all routes with specific origins
app.use(
  cors({
    origin: [
      'http://localhost:19006',
      'http://localhost:8081',
      'http://frontend:8081',
      'exp://localhost:19000',
      'exp://127.0.0.1:19000',
      'http://localhost:3000', // Add if using web
      'http://127.0.0.1:19006', // Add this
      'http://localhost:4001',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      // New Places API headers
      'X-Goog-Api-Key',
      'X-Goog-FieldMask',
    ],
  })
);

// Add this before the existing /proxy middleware
app.get('/proxy', (req, res) => {
  res.json({
    message: 'CORS Proxy is running',
    usage:
      'Use /proxy/[google-maps-api-path] to proxy requests to Google Maps API',
    example:
      '/proxy/maps/api/place/autocomplete/json?input=pizza&key=YOUR_API_KEY',
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('Health check endpoint hit');
  res.json({ status: 'ok', service: 'cors-proxy' });
});

// Add this middleware before your proxy to log all requests
app.use('/proxy', (req, res, next) => {
  console.log('=== PROXY REQUEST DEBUG ===');
  console.log('Method:', req.method);
  console.log('Original URL:', req.originalUrl);
  console.log('Path:', req.path);
  console.log('Query:', req.query);
  console.log('Headers:', req.headers);
  console.log('========================');
  next();
});

// More flexible proxy that accepts full URLs
app.use(
  '/proxy',
  createProxyMiddleware({
    target: 'https://maps.googleapis.com',
    changeOrigin: true,
    pathRewrite: (path, req) => {
      console.log(`Original path: ${path}`);

      // Remove /proxy prefix and any embedded googleapis.com URLs
      let rewrittenPath = path
        .replace(/^\/proxy\/?/, '/')
        .replace(/\/https:\/\/maps\.googleapis\.com/, '');

      console.log(`Rewritten path: ${rewrittenPath}`);
      return rewrittenPath;
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log(`Proxying request: ${req.method} ${req.url}`);
      console.log(`Target URL: https://maps.googleapis.com${proxyReq.path}`);
    },
    onError: (err, req, res) => {
      console.error('Proxy error:', err);
      res.status(500).json({ error: 'Proxy error', details: err.message });
    },
  })
);

// Proxy for Google Places API (New)
app.use(
  '/gplaces',
  createProxyMiddleware({
    target: 'https://places.googleapis.com',
    changeOrigin: true,
    pathRewrite: (path) => {
      // strip /gplaces prefix
      const rewritten = path.replace(/^\/gplaces\/?/, '/');
      console.log(`[GPLACES] Rewritten path: ${rewritten}`);
      return rewritten;
    },
    onProxyReq: (proxyReq, req) => {
      console.log(`[GPLACES] ${req.method} https://places.googleapis.com${proxyReq.path}`);
    },
    onError: (err, req, res) => {
      console.error('[GPLACES] Proxy error:', err);
      res.status(500).json({ error: 'Proxy error', details: err.message });
    },
  })
);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CORS proxy server running on http://0.0.0.0:${PORT}`);
  console.log(`Proxying Google Maps API requests...`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
});
