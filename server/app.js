'use strict';

/**
 * Express application assembly.
 *
 * Builds and returns the app without binding a port, so it can be imported by
 * tests and by tooling. Starting the server, running migrations and handling
 * shutdown belong to `index.js`.
 */

const path = require('node:path');
const fs = require('node:fs');

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');

const config = require('./config');
const logger = require('./lib/logger');
const apiRoutes = require('./http/routes');
const { apiNotFound, errorHandler } = require('./http/middleware');

const CLIENT_DIST = path.join(__dirname, '../client/dist');
const CLIENT_ASSETS = path.join(__dirname, '../client/src/assets');
const CLIENT_FONTS = path.join(__dirname, '../client/public/fonts');

function createApp() {
  const app = express();

  // Behind a reverse proxy the client IP arrives in X-Forwarded-For. Trusting
  // it unconditionally would let anyone spoof the address used for rate
  // limiting and audit records, so it is opt-in.
  app.set('trust proxy', config.http.trustProxy);
  app.disable('x-powered-by');

  // ---- request logging ----
  app.use(
    pinoHttp({
      logger,
      // Health checks would otherwise dominate the log.
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      customLogLevel(req, res, err) {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode })
      }
    })
  );

  // ---- security headers ----
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          // React and Tailwind emit style attributes, which CSP counts as
          // inline styles. Scripts remain restricted to same-origin files.
          'style-src': ["'self'", "'unsafe-inline'"],
          'font-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
          'object-src': ["'none'"]
        }
      },
      // The platform speaks plain HTTP on a local network by design. Enable
      // HSTS and COOP once TLS is terminated in front of it. On plain HTTP LAN
      // deployments (RFC 1918 IPs), browsers ignore COOP as untrustworthy and
      // report agent cluster mismatches if Origin-Agent-Cluster is emitted.
      hsts: config.http.enableHsts ? { maxAge: 31536000, includeSubDomains: true } : false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: config.http.enableHsts ? { policy: 'same-origin' } : false,
      originAgentCluster: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' }
    })
  );

  // ---- CORS ----
  // The SPA is served by this same process, so same-origin must always be
  // allowed regardless of which port the server runs on. A disallowed origin
  // is answered *without* CORS headers and the browser blocks it; returning an
  // error here would turn every such request into a 500.
  app.use(
    cors((req, callback) => {
      const origin = req.header('Origin');
      let allowed = true;

      if (origin) {
        allowed =
          config.http.allowedOrigins.includes(origin) ||
          (() => {
            try {
              const originUrl = new URL(origin);
              // Same origin host & port (production build or standard direct access)
              if (originUrl.host === req.headers.host) return true;

              // Same hostname (e.g. dev client running on port 5173 on the host or LAN IP)
              if (
                originUrl.hostname === req.hostname ||
                originUrl.hostname === 'localhost' ||
                originUrl.hostname === '127.0.0.1'
              ) {
                return true;
              }

              // Allow private network LAN addresses (RFC 1918) and local mDNS hostnames
              const host = originUrl.hostname.toLowerCase();
              return (
                /^10\./.test(host) ||
                /^192\.168\./.test(host) ||
                /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
                host.endsWith('.local')
              );
            } catch (e) {
              return false;
            }
          })();
      }

      callback(null, {
        origin: allowed,
        credentials: false,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
      });
    })
  );

  // ---- body parsing ----
  // Uploads go through multer with their own limits and never reach these.
  app.use(express.json({ limit: config.http.bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: config.http.bodyLimit }));

  // ---- static assets ----
  const staticOptions = { maxAge: '7d', fallthrough: true, index: false, dotfiles: 'deny' };
  app.use('/assets', express.static(CLIENT_ASSETS, staticOptions));
  app.use('/fonts', express.static(CLIENT_FONTS, staticOptions));

  // ---- API ----
  app.use('/api', apiRoutes);
  app.use('/api', apiNotFound);

  // ---- single-page application ----
  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST, { index: false, dotfiles: 'deny' }));
    app.get(/.*/, (req, res, next) => {
      if (req.path.startsWith('/assets') || req.path.startsWith('/fonts')) return next();
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  } else {
    logger.warn('client/dist not found — run "npm run build" to serve the web interface');
  }

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
